(function () {
  "use strict";

  /** Must match `datasetsMapping[0].alias` in manifest.json */
  var DATASET_ALIAS = "dataset";

  /**
   * Client vs data: the sidebar "Client" control is backed exclusively by the dataset
   * column PARTITION. Option values and `selectedClientId` are PARTITION strings; each
   * content row’s `partition` field is read from that same column for filtering.
   */
  /**
   * Active client PARTITION values (excludes keys starting with `z_`).
   * @type {{ id: string, label: string }[]}
   */
  var CLIENT_PARTITIONS = [];

  /** Selected client = selected PARTITION value from the dataset. */
  var selectedClientId = null;
  var partitionOptionsLoading = false;
  var partitionOptionsError = null;

  /** In Domo, content list rows load only after a client (PARTITION) is chosen. */
  var contentMetadataLoading = false;
  /** Ignores stale metadata responses if the user changes or clears the client mid-flight. */
  var contentLoadSeq = 0;
  /** Ignores stale year-filtered list fetches when the user changes year or client. */
  var yearListLoadSeq = 0;
  var yearListLoading = false;

  /** Max rows per metadata API request (Domo `limit` parameter). */
  var METADATA_ROW_LIMIT = 50000;

  /**
   * Full metadata rows per PARTITION (academic-year / program-solution chips + list when year cleared).
   * @type {Object.<string, { assetContentId: string, campaignName: string, contentName: string, contentHtml: string, partition: string|null, campaignYear: *, programSolution: string|null }[]>}
   */
  var partitionMetadataCache = Object.create(null);

  /**
   * Mirrors Beast Mode / SQL:
   * CONCAT('20', RIGHT(`CAMPAIGN_YEAR`, 2), '-20',
   *   RIGHT(CAST((CAST(RIGHT(`CAMPAIGN_YEAR`, 2) AS LONG) + 1) AS STRING), 2))
   */
  function academicYearLabelFromCampaignYear(campaignYear) {
    var s = campaignYear != null ? String(campaignYear) : "";
    var last2 = s.length <= 2 ? s : s.slice(-2);
    var n = parseInt(last2, 10);
    if (isNaN(n)) {
      return s;
    }
    var nextStr = String(n + 1).slice(-2);
    return "20" + last2 + "-20" + nextStr;
  }

  /**
   * Mirrors Beast Mode / SQL:
   * (CASE WHEN (LEFT(`ASSET_CONTENT_ID`, 1) = 'e') THEN 'Emails' ELSE 'Landing Pages' END)
   */
  function assetBucketFromContentId(assetContentId) {
    var s = assetContentId != null ? String(assetContentId) : "";
    return s.length > 0 && s.charAt(0) === "e" ? "emails" : "landing";
  }

  /**
   * @type {{ assetContentId: string, campaignName: string, contentName: string, contentHtml: string, partition: string|null, campaignYear: *, programSolution: string|null }[]}
   * `assetContentId` is ASSET_CONTENT_ID (preview, API). `campaignName` is CAMPAIGN_NAME for the list UI.
   * `partition` stores PARTITION (client key). `campaignYear` is raw CAMPAIGN_YEAR from the dataset.
   * `programSolution` is PROGRAM_SOLUTION (program solution name for sidebar chips).
   */
  var ALL_CONTENT_ROWS = [];

  var PAGE_SIZE = 7;
  /** Selected raw `CAMPAIGN_YEAR` values (matches dataset); empty = all years. */
  var selectedYears = [];
  /** Selected PROGRAM_SOLUTION values; empty = all program solutions. */
  var selectedProgramSolutions = [];
  /** @type {'emails'|'landing'} */
  var selectedAssetType = "emails";
  var contentFilter = "";
  var contentPage = 1;
  var selectedContentIndex = null;

  /** Incremented on each preview render to ignore stale CONTENT fetches. */
  var previewRequestSeq = 0;

  /** Cached preview HTML: cache key → { html: string }. Empty/failed loads are not stored. */
  var contentHtmlCache = Object.create(null);

  /** True when a metadata fetch returned >= METADATA_ROW_LIMIT rows. */
  var metadataTruncationPending = false;
  var metadataTruncationDismissed = false;

  var contentFilterDebounceTimer = null;
  var CONTENT_FILTER_DEBOUNCE_MS = 250;

  var sidebarCollapsed = false;
  var SIDEBAR_COLLAPSED_STORAGE_KEY = "ccb-sidebar-collapsed";

  /** Columns for list rows only — omit CONTENT to keep payload small. */
  var CONTENT_LIST_FIELDS =
    "PARTITION,ASSET_CONTENT_ID,CAMPAIGN_YEAR,PROGRAM_SOLUTION," +
    "PROGRAM_NAME,CAMPAIGN_NAME,PROGRAM,CAMPAIGN,CAMPAIGN_ID," +
    "CONTENT_NAME,CONTENTNAME,NAME,TITLE," +
    "SUBJECT,FROM_NAME,FROM_EMAIL";

  /** Injected into preview iframe shell (emails only); does not affect CONTENT fetch. */
  var EMAIL_PREVIEW_SHELL_STYLES =
    ".email-preview-meta{margin:0 0 4px;padding:0;}" +
    ".email-preview-line{margin:0 0 10px;font-size:14px;line-height:1.5;color:#141414;word-break:break-word;" +
    "font-family:\"Segoe UI\",system-ui,-apple-system,sans-serif,\"Segoe UI Emoji\",\"Apple Color Emoji\",\"Noto Color Emoji\",sans-serif;}" +
    ".email-preview-line strong{font-weight:700;}" +
    ".email-preview-divider{margin:0 0 20px;border:0;border-top:1px solid #d8d8d8;}";

  function $(id) {
    return document.getElementById(id);
  }

  function isDomoRuntime() {
    return typeof domo !== "undefined" && typeof domo.get === "function";
  }

  function isStandaloneDemo() {
    return !isDomoRuntime() && typeof CCB_DEMO_DATA !== "undefined";
  }

  /** Loads mock clients and per-partition row caches for GitHub / local demo. */
  function bootstrapStandaloneDemo() {
    if (!isStandaloneDemo()) return;
    var mock = CCB_DEMO_DATA;
    if (!mock || !mock.clients || !mock.rows) return;
    CLIENT_PARTITIONS = mock.clients.slice();
    partitionMetadataCache = Object.create(null);
    mock.rows.forEach(function (row) {
      var part =
        row.partition != null ? String(row.partition).trim() : "";
      if (!part) return;
      if (!partitionMetadataCache[part]) {
        partitionMetadataCache[part] = [];
      }
      partitionMetadataCache[part].push({
        assetContentId: row.assetContentId,
        campaignName: row.campaignName,
        contentName: row.contentName || row.campaignName,
        contentHtml: row.contentHtml != null ? row.contentHtml : "",
        partition: part,
        campaignYear: row.campaignYear,
        programSolution: row.programSolution,
        fromEmail: row.fromEmail != null ? String(row.fromEmail) : "",
        fromName: row.fromName != null ? String(row.fromName) : "",
        subject: row.subject != null ? String(row.subject) : "",
      });
    });
    partitionOptionsError = null;
  }

  /** Academic year, campaign, asset type, search, pager — off until a client is picked (and not while rows load). */
  function shouldDisableNonClientFilters() {
    if (isDomoRuntime() || isStandaloneDemo()) {
      if (!selectedClientId) return true;
      if (contentMetadataLoading) return true;
      return false;
    }
    return false;
  }

  function escapeSqlFilterLiteral(s) {
    return String(s || "").replace(/'/g, "''");
  }

  function campaignYearSqlLiteral(year) {
    if (year == null || year === "") return "''";
    var s = String(year).trim();
    var na = Number(s);
    if (!isNaN(na) && String(na) === s) {
      return String(na);
    }
    return "'" + escapeSqlFilterLiteral(s) + "'";
  }

  function buildPartitionFilterExpr(partitionKey) {
    var part = partitionKey != null ? String(partitionKey).trim() : "";
    return "PARTITION = '" + escapeSqlFilterLiteral(part) + "'";
  }

  function buildPartitionYearFilterExpr(partitionKey, campaignYear) {
    return (
      buildPartitionFilterExpr(partitionKey) +
      " AND CAMPAIGN_YEAR = " +
      campaignYearSqlLiteral(campaignYear)
    );
  }

  function cloneContentRows(rows) {
    return rows.map(function (r) {
      return {
        assetContentId: r.assetContentId,
        campaignName: r.campaignName,
        contentName: r.contentName,
        contentHtml: r.contentHtml != null ? r.contentHtml : "",
        partition: r.partition,
        campaignYear: r.campaignYear,
        programSolution: r.programSolution,
        fromEmail: r.fromEmail != null ? String(r.fromEmail) : "",
        fromName: r.fromName != null ? String(r.fromName) : "",
        subject: r.subject != null ? String(r.subject) : "",
      };
    });
  }

  /**
   * Email header columns on the dataset (exact Domo names).
   * Subject → SUBJECT; From line → FROM_NAME + FROM_EMAIL; Pre-Header → parsed from CONTENT HTML.
   */
  function emailHeaderFieldsFromDomoRow(domRow) {
    if (!domRow || typeof domRow !== "object") {
      return {
        fromEmail: "",
        fromName: "",
        subject: "",
      };
    }
    return {
      fromName: trimOrEmpty(
        pickField(domRow, ["FROM_NAME", "from_name"])
      ),
      fromEmail: trimOrEmpty(
        pickField(domRow, ["FROM_EMAIL", "from_email"])
      ),
      subject: trimOrEmpty(
        pickField(domRow, ["SUBJECT", "subject"])
      ),
    };
  }

  function withEmailHeaderFields(rowObj, domRow) {
    var h = emailHeaderFieldsFromDomoRow(domRow);
    rowObj.fromName = h.fromName;
    rowObj.fromEmail = h.fromEmail;
    rowObj.subject = h.subject;
    return rowObj;
  }

  function escapeHtmlText(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Decodes &#128274; / &#x1F511; / &amp; etc. so emojis render in header lines. */
  function decodeHtmlEntitiesForDisplay(text) {
    var s = String(text || "");
    if (!s) return "";
    s = s.replace(/&#(\d+);/g, function (_, code) {
      var n = parseInt(code, 10);
      if (isNaN(n)) return _;
      try {
        return String.fromCodePoint(n);
      } catch (e) {
        return "";
      }
    });
    s = s.replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (e) {
        return "";
      }
    });
    try {
      var ta = document.createElement("textarea");
      ta.innerHTML = s;
      s = ta.value;
    } catch (e2) {
      /* ignore */
    }
    return s;
  }

  function formatHeaderDisplayText(value) {
    return escapeHtmlText(decodeHtmlEntitiesForDisplay(value));
  }

  function textFromPreheaderElement(el) {
    if (!el) return "";
    var t = trimOrEmpty(el.textContent);
    if (t) return t;
    var imgs = el.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      var alt = trimOrEmpty(imgs[i].getAttribute("alt"));
      if (alt) return alt;
    }
    return "";
  }

  /** Reads preheader text already present in CONTENT HTML (display only). */
  function extractPreheaderFromContentHtml(html) {
    var raw = trimOrEmpty(html);
    if (!raw) return "";
    try {
      var doc = new DOMParser().parseFromString(raw, "text/html");
      var body = doc.body;
      if (!body) return "";
      var byId =
        doc.getElementById("preheader") || doc.getElementById("pre-header");
      if (byId) {
        var idText = trimOrEmpty(textFromPreheaderElement(byId));
        if (idText) return decodeHtmlEntitiesForDisplay(idText);
      }
      var marked = body.querySelectorAll("[class],[id]");
      for (var i = 0; i < marked.length; i++) {
        var el = marked[i];
        var cn = el.className != null ? String(el.className) : "";
        var eid = el.id != null ? String(el.id) : "";
        if (/preheader|pre-header/i.test(cn + " " + eid)) {
          var t = trimOrEmpty(textFromPreheaderElement(el));
          if (t) return decodeHtmlEntitiesForDisplay(t);
        }
      }
    } catch (e) {
      /* DOMParser unavailable */
    }
    var m = raw.match(
      /class=["'][^"']*\bpre-?header\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p|td)/i
    );
    if (m && m[1]) {
      var stripped = m[1].replace(/<[^>]+>/g, " ");
      var t2 = trimOrEmpty(decodeHtmlEntitiesForDisplay(stripped));
      if (t2) return t2;
    }
    return "";
  }

  /** "Name <email@example.com>" or whichever part is available. */
  function formatEmailFromDisplay(fromName, fromEmail) {
    var name = trimOrEmpty(fromName);
    var email = trimOrEmpty(fromEmail);
    if (name && email) {
      return name + " <" + email + ">";
    }
    return name || email || "";
  }

  /** Prepended above CONTENT in preview for emails; returns "" when there is nothing to show. */
  function buildEmailPreviewHeaderHtml(row, contentHtml) {
    var subject = trimOrEmpty(decodeHtmlEntitiesForDisplay(row.subject));
    var fromLine = formatEmailFromDisplay(
      trimOrEmpty(row.fromName),
      trimOrEmpty(row.fromEmail)
    );
    var preheader = extractPreheaderFromContentHtml(contentHtml);
    if (!subject && !fromLine && !preheader) {
      return "";
    }

    var lines = [];
    function pushLine(label, value) {
      if (!value) return;
      lines.push(
        "<p class=\"email-preview-line\"><strong>" +
          escapeHtmlText(label) +
          ":</strong> " +
          formatHeaderDisplayText(value) +
          "</p>"
      );
    }
    pushLine("Subject", subject);
    pushLine("From", fromLine);
    pushLine("Pre-Header", preheader);

    if (!lines.length) {
      return "";
    }

    return (
      "<div class=\"email-preview-meta\">" +
      lines.join("") +
      "</div><hr class=\"email-preview-divider\" />"
    );
  }

  /** Display-only wrapper: always includes full `contentHtml` after optional header block. */
  function wrapEmailPreviewBody(row, contentHtml) {
    var html = contentHtml != null ? String(contentHtml) : "";
    if (assetBucketFromContentId(row.assetContentId) !== "emails") {
      return html;
    }
    return buildEmailPreviewHeaderHtml(row, html) + html;
  }

  function getPartitionCacheRows(partitionKey) {
    var k = partitionKey != null ? String(partitionKey).trim() : "";
    if (!k || !partitionMetadataCache[k]) return null;
    var rows = partitionMetadataCache[k];
    if (!rows.length) return null;
    return rows;
  }

  function setPartitionCacheRows(partitionKey, rows) {
    var k = partitionKey != null ? String(partitionKey).trim() : "";
    if (!k) return;
    partitionMetadataCache[k] = cloneContentRows(rows);
  }

  function warnIfMetadataLimitHit(rowCount, contextLabel) {
    if (rowCount >= METADATA_ROW_LIMIT) {
      metadataTruncationPending = true;
      metadataTruncationDismissed = false;
      console.warn(
        "Metadata row limit (" +
          METADATA_ROW_LIMIT +
          ") reached" +
          (contextLabel ? " for " + contextLabel : "") +
          "; results may be truncated."
      );
      renderTruncationBanner();
    }
  }

  function clearMetadataTruncationState() {
    metadataTruncationPending = false;
    metadataTruncationDismissed = false;
    renderTruncationBanner();
  }

  function contentHtmlCacheKey(assetContentId) {
    var id = String(assetContentId || "").trim();
    var part =
      selectedClientId != null ? String(selectedClientId).trim() : "";
    return part ? part + "\x1e" + id : id;
  }

  function clearContentHtmlCache() {
    contentHtmlCache = Object.create(null);
  }

  function getCachedContentHtml(assetContentId) {
    var entry = contentHtmlCache[contentHtmlCacheKey(assetContentId)];
    if (!entry || entry.html == null) return null;
    var html = String(entry.html);
    return html.trim() !== "" ? html : null;
  }

  function setCachedContentHtml(assetContentId, html) {
    if (html == null || String(html).trim() === "") return;
    contentHtmlCache[contentHtmlCacheKey(assetContentId)] = {
      html: String(html),
    };
  }

  function renderTruncationBanner() {
    var banner = $("metadata-truncation-banner");
    if (!banner) return;
    var show =
      metadataTruncationPending && !metadataTruncationDismissed;
    banner.hidden = !show;
  }

  function readSidebarCollapsedPreference() {
    try {
      return sessionStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function persistSidebarCollapsedPreference() {
    try {
      sessionStorage.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        sidebarCollapsed ? "1" : "0"
      );
    } catch (e) {
      /* sessionStorage unavailable */
    }
  }

  function applySidebarCollapsedState() {
    var shell = $("app-shell");
    var btn = $("sidebar-toggle");
    var label = btn ? btn.querySelector(".sidebar-toggle__label") : null;
    if (shell) {
      shell.classList.toggle("app-shell--sidebar-collapsed", sidebarCollapsed);
    }
    if (btn) {
      btn.setAttribute("aria-expanded", sidebarCollapsed ? "false" : "true");
    }
    if (label) {
      label.textContent = sidebarCollapsed ? "Show filters" : "Hide filters";
    }
  }

  function toggleSidebarCollapsed() {
    sidebarCollapsed = !sidebarCollapsed;
    persistSidebarCollapsedPreference();
    applySidebarCollapsedState();
  }

  function normalizeDataRows(resp) {
    if (Array.isArray(resp)) return resp;
    if (resp && Array.isArray(resp.rows)) return resp.rows;
    if (resp && Array.isArray(resp.data)) return resp.data;
    return [];
  }

  function pickField(row, keys) {
    if (!row || typeof row !== "object") return null;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (Object.prototype.hasOwnProperty.call(row, k)) {
        var v = row[k];
        if (v != null && v !== "") return v;
      }
    }
    return null;
  }

  /** PARTITION column value — used as the client key for this app. */
  function partitionValueFromRow(row) {
    return pickField(row, ["PARTITION", "partition"]);
  }

  /** Inactive clients use PARTITION values prefixed with `z_` (case-insensitive). */
  function isInactiveClientPartition(partitionKey) {
    var s = partitionKey != null ? String(partitionKey).trim() : "";
    return s.length >= 2 && s.substring(0, 2).toLowerCase() === "z_";
  }

  /** PARTITION values omitted from the Client dropdown (case-insensitive). */
  var HIDDEN_CLIENT_PARTITION_KEYS = {
    "1_all": true,
    "2_default": true,
  };

  function isHiddenClientPartition(partitionKey) {
    var s = partitionKey != null ? String(partitionKey).trim() : "";
    if (!s) return false;
    return !!HIDDEN_CLIENT_PARTITION_KEYS[s.toLowerCase()];
  }

  function isExcludedClientPartition(partitionKey) {
    return (
      isInactiveClientPartition(partitionKey) ||
      isHiddenClientPartition(partitionKey)
    );
  }

  function trimOrEmpty(v) {
    if (v == null) return "";
    return String(v).trim();
  }

  /** Human-readable list label: "Program — Campaign" when both exist. */
  function joinProgramCampaignLabels(programVal, campaignVal) {
    var p = trimOrEmpty(programVal);
    var c = trimOrEmpty(campaignVal);
    if (p && c) return p + " — " + c;
    if (p) return p;
    if (c) return c;
    return "";
  }

  function programLabelFromRow(row) {
    return pickField(row, [
      "PROGRAM_NAME",
      "program_name",
      "PROGRAMNAME",
      "PROGRAM",
      "program",
    ]);
  }

  function campaignLabelFromRow(row) {
    return pickField(row, [
      "CAMPAIGN_NAME",
      "campaign_name",
      "CAMPAIGNNAME",
      "CAMPAIGN",
      "campaign",
      "CAMPAIGN_ID",
      "campaign_id",
    ]);
  }

  function campaignYearFromRow(row) {
    return pickField(row, [
      "CAMPAIGN_YEAR",
      "campaign_year",
      "Campaign_Year",
    ]);
  }

  function programSolutionFromRow(row) {
    return pickField(row, [
      "PROGRAM_SOLUTION",
      "program_solution",
      "Program_Solution",
    ]);
  }

  /** CAMPAIGN_NAME for Content name list display (not CAMPAIGN / CAMPAIGN_ID). */
  function campaignNameFromRow(row) {
    return pickField(row, [
      "CAMPAIGN_NAME",
      "campaign_name",
      "CAMPAIGNNAME",
    ]);
  }

  function listDisplayNameFromRow(row, assetContentId) {
    var name = trimOrEmpty(campaignNameFromRow(row));
    if (name) return name;
    var id = assetContentId != null ? String(assetContentId) : "";
    return id || "Untitled";
  }

  /**
   * Maps a Domo row to list + preview shape (`CONTENT` holds HTML for the right pane).
   * `partition` on the result is PARTITION (client key).
   */
  function mapRowToContent(row) {
    var id = pickField(row, ["ASSET_CONTENT_ID", "asset_content_id"]);
    var html = pickField(row, ["CONTENT", "content"]);
    var part = partitionValueFromRow(row);
    var cy = campaignYearFromRow(row);
    var ps = programSolutionFromRow(row);
    var campaignName = trimOrEmpty(campaignNameFromRow(row));
    return withEmailHeaderFields(
      {
        assetContentId: id != null ? String(id) : "",
        campaignName: campaignName,
        contentName: listDisplayNameFromRow(row, id),
        contentHtml: html != null ? String(html) : "",
        partition: part != null ? String(part) : null,
        campaignYear: cy != null && cy !== "" ? cy : null,
        programSolution:
          ps != null && ps !== "" ? String(ps).trim() : null,
      },
      row
    );
  }

  /**
   * List rows from Domo without CONTENT; HTML is loaded on demand for preview.
   * `partition` on each object is the PARTITION column (client identifier).
   */
  function mapMetadataRow(row) {
    var id = pickField(row, ["ASSET_CONTENT_ID", "asset_content_id"]);
    var part = partitionValueFromRow(row);
    var cy = campaignYearFromRow(row);
    var ps = programSolutionFromRow(row);
    var campaignName = trimOrEmpty(campaignNameFromRow(row));
    return withEmailHeaderFields(
      {
        assetContentId: id != null ? String(id) : "",
        campaignName: campaignName,
        contentName: listDisplayNameFromRow(row, id),
        contentHtml: "",
        partition: part != null ? String(part) : null,
        campaignYear: cy != null && cy !== "" ? cy : null,
        programSolution:
          ps != null && ps !== "" ? String(ps).trim() : null,
      },
      row
    );
  }

  function applyPartitionBackfill(mapped, partitionKey) {
    var part = partitionKey != null ? String(partitionKey).trim() : "";
    if (!part) return mapped;
    return mapped.map(function (m) {
      m.partition = part;
      return m;
    });
  }

  /**
   * Loads list metadata for one PARTITION (client), optionally scoped to CAMPAIGN_YEAR.
   * Full-partition loads are stored in `partitionMetadataCache`; year-scoped loads only update
   * `ALL_CONTENT_ROWS` (list) and leave the cache intact for academic-year chips.
   * @param {string} partitionKey PARTITION value / client id
   * @param {number} requestSeq Must match `contentLoadSeq` when the response arrives or it is discarded.
   * @param {*} [campaignYear] When set, filter includes CAMPAIGN_YEAR (does not update partition cache).
   */
  function fetchContentRowMetadataFromDomo(
    partitionKey,
    requestSeq,
    campaignYear,
    yearRequestSeq
  ) {
    if (!isDomoRuntime()) {
      return Promise.resolve();
    }
    var part = partitionKey != null ? String(partitionKey).trim() : "";
    if (!part) {
      ALL_CONTENT_ROWS = [];
      return Promise.resolve();
    }
    var yearScoped =
      campaignYear != null && campaignYear !== "";
    var filterExpr = yearScoped
      ? buildPartitionYearFilterExpr(part, campaignYear)
      : buildPartitionFilterExpr(part);
    var filterQs = "&filter=" + encodeURIComponent(filterExpr);
    var base = "/data/v2/" + encodeURIComponent(DATASET_ALIAS);
    var limitQs = "&limit=" + String(METADATA_ROW_LIMIT);

    function applyMappedRows(mapped) {
      if (requestSeq != null && requestSeq !== contentLoadSeq) return;
      if (
        yearScoped &&
        yearRequestSeq != null &&
        yearRequestSeq !== yearListLoadSeq
      ) {
        return;
      }
      if (!yearScoped) {
        setPartitionCacheRows(part, mapped);
      }
      ALL_CONTENT_ROWS = mapped.length > 0 ? mapped : [];
    }

    function fallbackFromCacheByYear() {
      if (requestSeq != null && requestSeq !== contentLoadSeq) return;
      if (
        yearScoped &&
        yearRequestSeq != null &&
        yearRequestSeq !== yearListLoadSeq
      ) {
        return;
      }
      var cached = getPartitionCacheRows(part);
      if (!cached) {
        ALL_CONTENT_ROWS = [];
        return;
      }
      ALL_CONTENT_ROWS = cached.filter(function (row) {
        return yearValuesMatch(campaignYear, row.campaignYear);
      });
    }

    var url =
      base +
      "?fields=" +
      encodeURIComponent(CONTENT_LIST_FIELDS) +
      limitQs +
      filterQs;
    return domo
      .get(url)
      .then(function (resp) {
        if (requestSeq != null && requestSeq !== contentLoadSeq) return;
        var rows = normalizeDataRows(resp);
        warnIfMetadataLimitHit(
          rows.length,
          yearScoped ? "PARTITION+year list" : "PARTITION " + part
        );
        var mapped = applyPartitionBackfill(rows.map(mapMetadataRow), part);
        applyMappedRows(mapped);
      })
      .catch(function (err) {
        console.warn(
          "Content metadata load failed (wide fields); retry narrow fields",
          err
        );
        return domo
          .get(
            base +
              "?fields=" +
              encodeURIComponent(
                "PARTITION,ASSET_CONTENT_ID,CAMPAIGN_YEAR,PROGRAM_SOLUTION,CAMPAIGN_NAME," +
                "SUBJECT,FROM_NAME,FROM_EMAIL"
              ) +
              limitQs +
              filterQs
          )
          .then(function (resp2) {
            if (requestSeq != null && requestSeq !== contentLoadSeq) return;
            var rows2 = normalizeDataRows(resp2);
            warnIfMetadataLimitHit(rows2.length, "narrow metadata");
            var mapped2 = applyPartitionBackfill(rows2.map(mapMetadataRow), part);
            applyMappedRows(mapped2);
          })
          .catch(function (err2) {
            console.warn("Content metadata load failed", err2);
            if (requestSeq != null && requestSeq !== contentLoadSeq) return;
            if (yearScoped) {
              fallbackFromCacheByYear();
            } else {
              ALL_CONTENT_ROWS = [];
            }
          });
      });
  }

  function contentHtmlFromFirstRow(rows) {
    if (!rows || !rows.length) return "";
    var html = pickField(rows[0], ["CONTENT", "content"]);
    return html != null ? String(html) : "";
  }

  /** Clears per-row preview fetch flags so a failed load can be retried after selection changes. */
  function resetPreviewRetryState() {
    ALL_CONTENT_ROWS.forEach(function (row) {
      delete row._contentLoadAttempted;
    });
  }

  function fetchContentHtmlByFilter(filterExpr) {
    var base = "/data/v2/" + encodeURIComponent(DATASET_ALIAS);
    var url =
      base +
      "?fields=" +
      encodeURIComponent("CONTENT") +
      "&limit=1&filter=" +
      encodeURIComponent(filterExpr);
    return domo.get(url).then(function (resp) {
      return contentHtmlFromFirstRow(normalizeDataRows(resp));
    });
  }

  /**
   * Scoped fallback when filter+limit=1 returns no row (network/API error path).
   */
  function fetchContentHtmlPartitionScopedScan(assetContentId, filterExpr) {
    var id = String(assetContentId || "").trim();
    var base = "/data/v2/" + encodeURIComponent(DATASET_ALIAS);
    return domo
      .get(
        base +
          "?fields=" +
          encodeURIComponent("CONTENT,ASSET_CONTENT_ID,PARTITION") +
          "&limit=" +
          String(METADATA_ROW_LIMIT) +
          "&filter=" +
          encodeURIComponent(filterExpr)
      )
      .then(function (resp2) {
        var rows2 = normalizeDataRows(resp2);
        for (var i = 0; i < rows2.length; i++) {
          var rid = pickField(rows2[i], [
            "ASSET_CONTENT_ID",
            "asset_content_id",
          ]);
          if (rid != null && String(rid) === id) {
            return contentHtmlFromFirstRow([rows2[i]]);
          }
        }
        return "";
      })
      .catch(function () {
        return "";
      });
  }

  /**
   * Loads CONTENT for one ASSET_CONTENT_ID. Tries PARTITION+id when a client is selected,
   * then retries ASSET_CONTENT_ID only if empty. Fallback scans stay filter-scoped.
   */
  function fetchContentHtmlByAssetId(assetContentId) {
    var id = String(assetContentId || "").trim();
    if (!id) return Promise.resolve("");
    if (typeof domo === "undefined" || typeof domo.get !== "function") {
      return Promise.resolve("");
    }
    var cachedHtml = getCachedContentHtml(id);
    if (cachedHtml != null) {
      return Promise.resolve(cachedHtml);
    }
    var escaped = id.replace(/'/g, "''");
    var assetFilter = "ASSET_CONTENT_ID = '" + escaped + "'";
    var part =
      selectedClientId != null ? String(selectedClientId).trim() : "";
    var partitionAssetFilter = part
      ? buildPartitionFilterExpr(part) + " AND " + assetFilter
      : null;

    function loadWithFilter(filterExpr) {
      return fetchContentHtmlByFilter(filterExpr).catch(function (err) {
        console.warn("CONTENT filter fetch failed; partition-scoped scan", err);
        return fetchContentHtmlPartitionScopedScan(id, filterExpr);
      });
    }

    function nonEmpty(html) {
      return html != null && String(html).trim() !== "";
    }

    function finish(html) {
      if (nonEmpty(html)) {
        setCachedContentHtml(id, html);
      }
      return html;
    }

    if (partitionAssetFilter) {
      return loadWithFilter(partitionAssetFilter).then(function (html) {
        if (nonEmpty(html)) return finish(html);
        return loadWithFilter(assetFilter).then(finish);
      });
    }
    return loadWithFilter(assetFilter).then(finish);
  }

  function applyCachedPartitionToUi(partitionKey) {
    var cached = getPartitionCacheRows(partitionKey);
    if (!cached) return false;
    ALL_CONTENT_ROWS = cloneContentRows(cached);
    return true;
  }

  /**
   * Populates the Client dropdown from distinct PARTITION values (client keys).
   * For very large datasets, prefer a DQL/SQL dataset (manifest `dql`) that returns DISTINCT PARTITION only.
   */
  function fetchClientPartitionsFromDomo() {
    if (typeof domo === "undefined" || typeof domo.get !== "function") {
      return Promise.resolve();
    }
    var url =
      "/data/v2/" +
      encodeURIComponent(DATASET_ALIAS) +
      "?fields=PARTITION&limit=10000";
    return domo.get(url).then(function (resp) {
      var rows = normalizeDataRows(resp);
      var seen = Object.create(null);
      var out = [];
      rows.forEach(function (row) {
        var raw = partitionValueFromRow(row);
        if (raw == null || raw === "") return;
        var key = String(raw).trim();
        if (!key || seen[key] || isExcludedClientPartition(key)) return;
        seen[key] = true;
        out.push({ id: key, label: key });
      });
      out.sort(function (a, b) {
        return a.label.localeCompare(b.label, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
      partitionOptionsError = null;
      CLIENT_PARTITIONS = out;
      if (selectedClientId && isExcludedClientPartition(selectedClientId)) {
        selectedClientId = null;
        selectedYears = [];
        selectedProgramSolutions = [];
        selectedContentIndex = null;
        resetPreviewRetryState();
        if (isDomoRuntime()) {
          ALL_CONTENT_ROWS = [];
        }
      }
    }).catch(function (err) {
      console.warn("Client PARTITION load failed", err);
      CLIENT_PARTITIONS = [];
      partitionOptionsError =
        "Could not load clients. Check card dataset mapping (alias \"" +
        DATASET_ALIAS +
        "\").";
    });
  }

  function syncSidebarLoadingOverlay() {
    var el = $("sidebar-loading");
    if (!el) return;
    if (partitionOptionsLoading) {
      el.hidden = false;
      el.setAttribute("aria-busy", "true");
    } else {
      el.hidden = true;
      el.setAttribute("aria-busy", "false");
    }
  }

  function renderClientPartition() {
    syncSidebarLoadingOverlay();
    var sel = $("client-partition");
    if (!sel) return;
    sel.innerHTML = "";

    if (partitionOptionsLoading) {
      var loadOpt = document.createElement("option");
      loadOpt.value = "";
      loadOpt.textContent = "Loading clients…";
      loadOpt.disabled = true;
      loadOpt.selected = true;
      sel.appendChild(loadOpt);
      sel.disabled = true;
      return;
    }

    if (partitionOptionsError) {
      var errOpt = document.createElement("option");
      errOpt.value = "";
      errOpt.textContent = partitionOptionsError;
      errOpt.disabled = true;
      errOpt.selected = true;
      sel.appendChild(errOpt);
      sel.disabled = true;
      selectedClientId = null;
      return;
    }

    var hasClients = CLIENT_PARTITIONS.length > 0;

    if (!hasClients) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No clients in dataset";
      opt.disabled = true;
      opt.selected = true;
      sel.appendChild(opt);
      sel.disabled = true;
      selectedClientId = null;
      return;
    }

    sel.disabled = false;
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a client…";
    placeholder.selected = !selectedClientId;
    sel.appendChild(placeholder);

    CLIENT_PARTITIONS.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.label;
      if (selectedClientId === c.id) {
        o.selected = true;
        placeholder.selected = false;
      }
      sel.appendChild(o);
    });
  }

  function syncDependentFilterUI() {
    var dis = shouldDisableNonClientFilters();
    var resetBtn = $("filter-reset");
    if (resetBtn) {
      resetBtn.disabled =
        (isDomoRuntime() || isStandaloneDemo()) && !selectedClientId;
    }
    var cf = $("content-filter");
    if (cf) {
      cf.disabled = dis;
    }
    var emailsBtn = $("asset-emails");
    var landingBtn = $("asset-landing");
    if (emailsBtn) {
      emailsBtn.disabled = dis;
    }
    if (landingBtn) {
      landingBtn.disabled = dis;
    }
    var ay = $("academic-years");
    if (ay) {
      var pAy = ay.closest(".panel");
      if (pAy) {
        pAy.classList.toggle("panel--filters-muted", dis);
      }
    }
    var cap = $("campaigns");
    if (cap) {
      var pCap = cap.closest(".panel");
      if (pCap) {
        pCap.classList.toggle("panel--filters-muted", dis);
      }
    }
    if (emailsBtn) {
      var pAsset = emailsBtn.closest(".panel");
      if (pAsset) {
        pAsset.classList.toggle("panel--filters-muted", dis);
      }
    }
    if (cf) {
      var np = cf.closest(".name-picker");
      if (np) {
        np.classList.toggle("name-picker--filters-muted", dis);
      }
    }
  }

  function onClientPartitionChange() {
    var sel = $("client-partition");
    if (!sel) return;
    contentLoadSeq++;
    yearListLoadSeq++;
    yearListLoading = false;
    clearMetadataTruncationState();
    clearContentHtmlCache();
    var seq = contentLoadSeq;
    var v = sel.value;
    selectedClientId = v ? String(v).trim() : null;
    selectedYears = [];
    selectedProgramSolutions = [];
    contentPage = 1;
    selectedContentIndex = null;
    resetPreviewRetryState();

    if (!isDomoRuntime()) {
      if (selectedClientId && applyCachedPartitionToUi(selectedClientId)) {
        contentMetadataLoading = false;
      } else if (!selectedClientId) {
        ALL_CONTENT_ROWS = [];
      }
      syncDependentFilterUI();
      renderAcademicYearChips();
      renderProgramSolutionChips();
      renderContentList();
      return;
    }

    if (!selectedClientId) {
      contentMetadataLoading = false;
      ALL_CONTENT_ROWS = [];
      syncDependentFilterUI();
      renderAcademicYearChips();
      renderProgramSolutionChips();
      renderContentList();
      return;
    }

    yearListLoading = false;
    var cachedRows = getPartitionCacheRows(selectedClientId);
    if (cachedRows) {
      ALL_CONTENT_ROWS = cloneContentRows(cachedRows);
      contentMetadataLoading = false;
      syncDependentFilterUI();
      pruneInvalidYearSelection();
      pruneInvalidProgramSolutionSelection();
      renderAcademicYearChips();
      renderProgramSolutionChips();
      renderContentList();
      return;
    }

    ALL_CONTENT_ROWS = [];
    contentMetadataLoading = true;
    syncDependentFilterUI();
    renderAcademicYearChips();
    renderProgramSolutionChips();
    renderContentList();

    fetchContentRowMetadataFromDomo(selectedClientId, seq)
      .finally(function () {
        if (seq !== contentLoadSeq) return;
        contentMetadataLoading = false;
        pruneInvalidYearSelection();
        pruneInvalidProgramSolutionSelection();
        syncDependentFilterUI();
        renderAcademicYearChips();
        renderProgramSolutionChips();
        renderContentList();
      });
  }

  function valuesEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return String(a) === String(b);
  }

  function yearValuesMatch(a, b) {
    if (a == null || b == null || b === "") return false;
    if (valuesEqual(a, b)) return true;
    var na = Number(a);
    var nb = Number(b);
    return !isNaN(na) && !isNaN(nb) && na === nb;
  }

  function yearIsSelected(chipValue) {
    for (var i = 0; i < selectedYears.length; i++) {
      if (yearValuesMatch(selectedYears[i], chipValue)) return true;
    }
    return false;
  }

  function programSolutionIsSelected(chipValue) {
    for (var i = 0; i < selectedProgramSolutions.length; i++) {
      if (valuesEqual(selectedProgramSolutions[i], chipValue)) return true;
    }
    return false;
  }

  function toggleSelectedYear(chipValue) {
    for (var i = 0; i < selectedYears.length; i++) {
      if (yearValuesMatch(selectedYears[i], chipValue)) {
        selectedYears.splice(i, 1);
        return;
      }
    }
    selectedYears.push(chipValue);
  }

  function toggleSelectedProgramSolution(chipValue) {
    for (var i = 0; i < selectedProgramSolutions.length; i++) {
      if (valuesEqual(selectedProgramSolutions[i], chipValue)) {
        selectedProgramSolutions.splice(i, 1);
        return;
      }
    }
    selectedProgramSolutions.push(chipValue);
  }

  /** Rows used for academic-year chips (full partition cache when available). */
  function rowsForAcademicYearChips() {
    if (!selectedClientId) return [];
    var cached = getPartitionCacheRows(selectedClientId);
    if (cached) return cached;
    var clientKey = String(selectedClientId).trim();
    return ALL_CONTENT_ROWS.filter(function (row) {
      return valuesEqual(
        row.partition != null ? String(row.partition).trim() : "",
        clientKey
      );
    });
  }

  /** Distinct CAMPAIGN_YEAR values for the selected PARTITION (newest first). */
  function deriveDistinctCampaignYearChipEntries() {
    if (!selectedClientId) return [];
    var seen = Object.create(null);
    var raw = [];
    rowsForAcademicYearChips().forEach(function (row) {
      var y = row.campaignYear;
      if (y == null || y === "") return;
      var k = String(y);
      if (seen[k]) return;
      seen[k] = true;
      raw.push(y);
    });
    raw.sort(function (a, b) {
      var na = Number(a);
      var nb = Number(b);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return nb - na;
      return String(b).localeCompare(String(a), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    return raw.map(function (cy) {
      return {
        value: cy,
        label: academicYearLabelFromCampaignYear(cy),
      };
    });
  }

  function pruneInvalidYearSelection() {
    if (!selectedYears.length) return;
    var entries = deriveDistinctCampaignYearChipEntries();
    selectedYears = selectedYears.filter(function (y) {
      for (var i = 0; i < entries.length; i++) {
        if (yearValuesMatch(y, entries[i].value)) return true;
      }
      return false;
    });
  }

  /** Distinct PROGRAM_SOLUTION values for the selected PARTITION (A–Z). */
  function deriveDistinctProgramSolutionChipEntries() {
    if (!selectedClientId) return [];
    var seen = Object.create(null);
    var raw = [];
    rowsForAcademicYearChips().forEach(function (row) {
      var ps = row.programSolution;
      if (ps == null || ps === "") return;
      var k = String(ps).trim();
      if (!k || seen[k]) return;
      seen[k] = true;
      raw.push(k);
    });
    raw.sort(function (a, b) {
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    return raw.map(function (ps) {
      return { value: ps, label: ps };
    });
  }

  function pruneInvalidProgramSolutionSelection() {
    if (!selectedProgramSolutions.length) return;
    var entries = deriveDistinctProgramSolutionChipEntries();
    selectedProgramSolutions = selectedProgramSolutions.filter(function (ps) {
      for (var i = 0; i < entries.length; i++) {
        if (valuesEqual(ps, entries[i].value)) return true;
      }
      return false;
    });
  }

  function programSolutionChipEntries() {
    return deriveDistinctProgramSolutionChipEntries();
  }

  function renderProgramSolutionChips() {
    renderMultiSelectChips(
      "campaigns",
      programSolutionChipEntries(),
      programSolutionIsSelected,
      programSolutionHandler,
      shouldDisableNonClientFilters()
    );
  }

  /**
   * @param {string} containerId
   * @param {{ value: *, label: string }[]} entries
   * @param {function(*): boolean} isSelected
   * @param {function(*): void} onToggle
   * @param {boolean} disabled
   */
  function renderMultiSelectChips(
    containerId,
    entries,
    isSelected,
    onToggle,
    disabled
  ) {
    var el = $(containerId);
    if (!el) return;
    el.innerHTML = "";
    entries.forEach(function (entry) {
      var val = entry.value;
      var lbl = entry.label;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (isSelected(val) ? " is-selected" : "");
      btn.setAttribute("aria-pressed", isSelected(val) ? "true" : "false");
      btn.textContent = lbl;
      btn.disabled = !!disabled;
      btn.addEventListener("click", function () {
        if (disabled) return;
        onToggle(val);
      });
      el.appendChild(btn);
    });
  }

  function academicYearChipEntries() {
    return deriveDistinctCampaignYearChipEntries();
  }

  function renderAcademicYearChips() {
    var dis = shouldDisableNonClientFilters();
    renderMultiSelectChips(
      "academic-years",
      academicYearChipEntries(),
      yearIsSelected,
      yearHandler,
      dis
    );
  }

  function yearHandler(v) {
    if (shouldDisableNonClientFilters()) return;
    toggleSelectedYear(v);
    contentPage = 1;
    selectedContentIndex = null;
    resetPreviewRetryState();
    renderAcademicYearChips();

    if (!isDomoRuntime() || !selectedClientId) {
      renderContentList();
      return;
    }

    if (selectedYears.length === 0) {
      yearListLoadSeq++;
      yearListLoading = false;
      if (applyCachedPartitionToUi(selectedClientId)) {
        renderContentList();
        return;
      }
      renderContentList();
      return;
    }

    if (selectedYears.length > 1) {
      yearListLoadSeq++;
      yearListLoading = false;
      if (applyCachedPartitionToUi(selectedClientId)) {
        renderContentList();
        return;
      }
      var multiYearSeq = yearListLoadSeq;
      var multiClientSeq = contentLoadSeq;
      yearListLoading = true;
      renderContentList();
      fetchContentRowMetadataFromDomo(selectedClientId, multiClientSeq)
        .finally(function () {
          if (
            multiYearSeq !== yearListLoadSeq ||
            multiClientSeq !== contentLoadSeq
          ) {
            return;
          }
          yearListLoading = false;
          renderContentList();
        });
      return;
    }

    yearListLoadSeq++;
    var yearSeq = yearListLoadSeq;
    var clientSeq = contentLoadSeq;
    yearListLoading = true;
    renderContentList();

    fetchContentRowMetadataFromDomo(
      selectedClientId,
      clientSeq,
      selectedYears[0],
      yearSeq
    )
      .finally(function () {
        if (yearSeq !== yearListLoadSeq || clientSeq !== contentLoadSeq) return;
        yearListLoading = false;
        renderContentList();
      });
  }

  function programSolutionHandler(v) {
    if (shouldDisableNonClientFilters()) return;
    toggleSelectedProgramSolution(v);
    contentPage = 1;
    selectedContentIndex = null;
    resetPreviewRetryState();
    renderProgramSolutionChips();
    renderContentList();
  }

  function getFilteredRows() {
    if ((isDomoRuntime() || isStandaloneDemo()) && !selectedClientId) {
      return [];
    }
    var rows = ALL_CONTENT_ROWS.filter(function (row) {
      return assetBucketFromContentId(row.assetContentId) === selectedAssetType;
    });
    // Client filter: `row.partition` is PARTITION; must match `selectedClientId`.
    if (selectedClientId) {
      var clientKey = String(selectedClientId).trim();
      rows = rows.filter(function (row) {
        return valuesEqual(
          row.partition != null ? String(row.partition).trim() : "",
          clientKey
        );
      });
    }
    if (selectedYears.length > 0) {
      rows = rows.filter(function (row) {
        for (var yi = 0; yi < selectedYears.length; yi++) {
          if (yearValuesMatch(selectedYears[yi], row.campaignYear)) return true;
        }
        return false;
      });
    }
    if (selectedProgramSolutions.length > 0) {
      rows = rows.filter(function (row) {
        for (var pi = 0; pi < selectedProgramSolutions.length; pi++) {
          if (
            valuesEqual(selectedProgramSolutions[pi], row.programSolution)
          ) {
            return true;
          }
        }
        return false;
      });
    }
    var q = contentFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (row) {
      var label = String(
        row.campaignName || row.contentName || ""
      ).toLowerCase();
      var id = String(row.assetContentId || "").toLowerCase();
      return label.indexOf(q) !== -1 || id.indexOf(q) !== -1;
    });
  }

  function renderPreview() {
    var frame = $("preview-frame");
    if (!frame) return;
    previewRequestSeq++;
    var seq = previewRequestSeq;
    var filtered = getFilteredRows();
    var row =
      selectedContentIndex != null ? filtered[selectedContentIndex] : null;
    var shellStart =
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<style>html,body{margin:0;padding:12px;font-family:\"Segoe UI\",system-ui,-apple-system,sans-serif,\"Segoe UI Emoji\",\"Apple Color Emoji\",\"Noto Color Emoji\",sans-serif;font-size:14px;line-height:1.45;}" +
      "a[href],area[href]{pointer-events:none;cursor:default;}" +
      EMAIL_PREVIEW_SHELL_STYLES +
      "</style></head><body>";
    var shellEnd = "</body></html>";
    if (!row) {
      var emptyMsg =
        (isDomoRuntime() || isStandaloneDemo()) && !selectedClientId
          ? "<p style=\"color:#5c5c5c;\">Select a client, then pick a content name to preview.</p>"
          : "<p style=\"color:#5c5c5c;\">Select an individual Content Name to refresh preview.</p>";
      frame.srcdoc = shellStart + emptyMsg + shellEnd;
      return;
    }
    var html = row.contentHtml || "";
    if (!html.trim() && row.assetContentId) {
      var cachedPreview = getCachedContentHtml(row.assetContentId);
      if (cachedPreview != null) {
        html = cachedPreview;
        row.contentHtml = html;
      }
    }
    if (
      !html.trim() &&
      row.assetContentId &&
      typeof domo !== "undefined" &&
      domo.get &&
      !row._contentLoadAttempted
    ) {
      frame.srcdoc =
        shellStart +
        "<p style=\"color:#5c5c5c;\">Loading content…</p>" +
        shellEnd;
      fetchContentHtmlByAssetId(row.assetContentId).then(function (loaded) {
        if (seq !== previewRequestSeq) return;
        row._contentLoadAttempted = true;
        row.contentHtml = loaded != null ? String(loaded) : "";
        renderPreview();
      });
      return;
    }
    if (!html.trim()) {
      frame.srcdoc =
        shellStart +
        "<p style=\"color:#5c5c5c;\">No CONTENT for this row.</p>" +
        shellEnd;
      return;
    }
    frame.srcdoc = shellStart + wrapEmailPreviewBody(row, html) + shellEnd;
  }

  function renderContentList() {
    var list = $("content-list");
    var filtered = getFilteredRows();
    var total = filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (total === 0) {
      selectedContentIndex = null;
    } else if (selectedContentIndex != null && selectedContentIndex >= total) {
      selectedContentIndex = total - 1;
    }
    if (contentPage > pages) contentPage = pages;
    if (contentPage < 1) contentPage = 1;

    var start = (contentPage - 1) * PAGE_SIZE;
    var slice = filtered.slice(start, start + PAGE_SIZE);

    list.innerHTML = "";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Content names");

    if (total === 0) {
      list.removeAttribute("tabindex");
      list.removeAttribute("aria-activedescendant");
      var emptyLi = document.createElement("li");
      emptyLi.className = "name-picker__empty";
      emptyLi.setAttribute("role", "presentation");
      var emptyTitle;
      var emptyHint;
      if (
        (isDomoRuntime() || isStandaloneDemo()) &&
        selectedClientId &&
        (contentMetadataLoading || yearListLoading)
      ) {
        emptyTitle = "Loading content…";
        emptyHint = yearListLoading
          ? "Fetching content for this academic year."
          : "Fetching content titles for this client.";
      } else if ((isDomoRuntime() || isStandaloneDemo()) && !selectedClientId) {
        emptyTitle = "Select a client first";
        emptyHint =
          "Choose a client above to load that partition’s titles. The full catalog is not loaded until then.";
      } else {
        emptyTitle = "No matching content";
        emptyHint =
          "Try another client, switch Emails / Landing Pages, or clear the search filter.";
      }
      emptyLi.innerHTML =
        "<p class=\"name-picker__empty-title\">" +
        emptyTitle +
        "</p>" +
        "<p class=\"name-picker__empty-hint\">" +
        emptyHint +
        "</p>";
      list.appendChild(emptyLi);
    } else {
      list.setAttribute("tabindex", "0");
      slice.forEach(function (row, i) {
        var globalIndex = start + i;
        var optId = "content-list-opt-" + globalIndex;
        var li = document.createElement("li");
        li.setAttribute("role", "option");
        li.id = optId;
        li.setAttribute(
          "aria-selected",
          selectedContentIndex === globalIndex ? "true" : "false"
        );
        li.className =
          selectedContentIndex === globalIndex ? "is-active" : "";
        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "content-name";
        radio.tabIndex = -1;
        radio.checked = selectedContentIndex === globalIndex;
        var label = document.createElement("span");
        label.textContent =
          row.campaignName || row.contentName || row.assetContentId || "Untitled";
        li.appendChild(radio);
        li.appendChild(label);
        li.addEventListener("click", function () {
          if (selectedContentIndex !== globalIndex) {
            resetPreviewRetryState();
          }
          selectedContentIndex = globalIndex;
          contentPage = Math.floor(globalIndex / PAGE_SIZE) + 1;
          renderContentList();
          list.focus();
        });
        list.appendChild(li);
      });
      if (selectedContentIndex != null) {
        list.setAttribute(
          "aria-activedescendant",
          "content-list-opt-" + selectedContentIndex
        );
      } else {
        list.removeAttribute("aria-activedescendant");
      }
    }

    var end = Math.min(start + slice.length, total);
    var meta =
      total === 0 ? "0 of 0" : start + 1 + " - " + end + " of " + total;
    $("pager-meta").textContent = meta;

    var filterLocked = shouldDisableNonClientFilters();
    $("pager-prev").disabled = filterLocked || contentPage <= 1;
    $("pager-next").disabled =
      filterLocked || contentPage >= pages || total === 0;

    syncDependentFilterUI();
    renderPreview();
  }

  function attachContentListKeyboard() {
    var list = $("content-list");
    if (!list || list._contentListKb) return;
    list._contentListKb = true;
    list.addEventListener("keydown", function (e) {
      if (shouldDisableNonClientFilters()) return;
      var filtered = getFilteredRows();
      var total = filtered.length;
      if (total === 0) return;
      var key = e.key;
      if (
        key === "ArrowDown" ||
        key === "ArrowUp" ||
        key === "Home" ||
        key === "End"
      ) {
        e.preventDefault();
        var idx = selectedContentIndex;
        if (key === "ArrowDown") {
          if (idx == null) idx = 0;
          else idx = Math.min(total - 1, idx + 1);
        } else if (key === "ArrowUp") {
          if (idx == null) idx = total - 1;
          else idx = Math.max(0, idx - 1);
        } else if (key === "Home") {
          idx = 0;
        } else {
          idx = total - 1;
        }
        if (selectedContentIndex !== idx) {
          resetPreviewRetryState();
        }
        selectedContentIndex = idx;
        contentPage = Math.floor(idx / PAGE_SIZE) + 1;
        renderContentList();
        list.focus();
      } else if (key === "Enter" || key === " ") {
        e.preventDefault();
        if (selectedContentIndex != null) {
          renderPreview();
        }
      }
    });
  }

  function clearContentFilterDebounce() {
    if (contentFilterDebounceTimer != null) {
      clearTimeout(contentFilterDebounceTimer);
      contentFilterDebounceTimer = null;
    }
  }

  function resetAllFilters() {
    contentLoadSeq++;
    yearListLoadSeq++;
    contentMetadataLoading = false;
    yearListLoading = false;
    clearContentFilterDebounce();
    clearMetadataTruncationState();
    clearContentHtmlCache();
    partitionMetadataCache = Object.create(null);
    if (isStandaloneDemo()) {
      bootstrapStandaloneDemo();
    }
    selectedClientId = null;
    selectedYears = [];
    selectedProgramSolutions = [];
    selectedAssetType = "emails";
    contentFilter = "";
    contentPage = 1;
    selectedContentIndex = null;
    resetPreviewRetryState();
    if (isDomoRuntime() || isStandaloneDemo()) {
      ALL_CONTENT_ROWS = [];
    }

    var cp = $("client-partition");
    if (cp) {
      cp.value = "";
    }
    var cf = $("content-filter");
    if (cf) {
      cf.value = "";
    }

    var emailsBtn = $("asset-emails");
    var landingBtn = $("asset-landing");
    if (emailsBtn && landingBtn) {
      emailsBtn.classList.add("is-selected");
      landingBtn.classList.remove("is-selected");
      emailsBtn.setAttribute("aria-checked", "true");
      landingBtn.setAttribute("aria-checked", "false");
    }

    renderClientPartition();
    renderAcademicYearChips();
    renderProgramSolutionChips();
    syncDependentFilterUI();
    renderContentList();
  }

  function attachHelpModal() {
    var modal = $("help-modal");
    var openBtn = $("help-open");
    var closeBtn = $("help-modal-close");
    if (!modal || !openBtn) return;

    function openHelp() {
      modal.hidden = false;
      document.body.classList.add("help-modal-open");
      openBtn.setAttribute("aria-expanded", "true");
      if (closeBtn) {
        closeBtn.focus();
      }
    }

    function closeHelp() {
      modal.hidden = true;
      document.body.classList.remove("help-modal-open");
      openBtn.setAttribute("aria-expanded", "false");
      openBtn.focus();
    }

    openBtn.addEventListener("click", openHelp);
    if (closeBtn) {
      closeBtn.addEventListener("click", closeHelp);
    }
    modal.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-help-close") != null) {
        closeHelp();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) {
        closeHelp();
      }
    });
  }

  function init() {
    var clientSel = $("client-partition");
    if (clientSel) {
      clientSel.addEventListener("change", onClientPartitionChange);
    }
    var resetBtn = $("filter-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", resetAllFilters);
    }
    partitionOptionsLoading = true;
    partitionOptionsError = null;
    if (isDomoRuntime() || isStandaloneDemo()) {
      ALL_CONTENT_ROWS = [];
    }
    renderClientPartition();

    if (isDomoRuntime()) {
      fetchClientPartitionsFromDomo().finally(function () {
        partitionOptionsLoading = false;
        renderClientPartition();
        syncDependentFilterUI();
      });
    } else {
      bootstrapStandaloneDemo();
      partitionOptionsLoading = false;
      renderClientPartition();
      syncDependentFilterUI();
    }

    renderAcademicYearChips();
    renderProgramSolutionChips();

    var emailsBtn = $("asset-emails");
    var landingBtn = $("asset-landing");
    function setAsset(type) {
      if (shouldDisableNonClientFilters()) return;
      selectedAssetType = type;
      contentPage = 1;
      selectedContentIndex = null;
      emailsBtn.classList.toggle("is-selected", type === "emails");
      landingBtn.classList.toggle("is-selected", type === "landing");
      emailsBtn.setAttribute(
        "aria-checked",
        type === "emails" ? "true" : "false"
      );
      landingBtn.setAttribute(
        "aria-checked",
        type === "landing" ? "true" : "false"
      );
      renderContentList();
    }
    emailsBtn.addEventListener("click", function () {
      setAsset("emails");
    });
    landingBtn.addEventListener("click", function () {
      setAsset("landing");
    });

    $("content-filter").addEventListener("input", function (e) {
      if (shouldDisableNonClientFilters()) return;
      clearContentFilterDebounce();
      var value = e.target.value;
      contentFilterDebounceTimer = setTimeout(function () {
        contentFilterDebounceTimer = null;
        if (shouldDisableNonClientFilters()) return;
        contentFilter = value;
        contentPage = 1;
        selectedContentIndex = null;
        renderContentList();
      }, CONTENT_FILTER_DEBOUNCE_MS);
    });

    var truncationDismiss = $("metadata-truncation-dismiss");
    if (truncationDismiss) {
      truncationDismiss.addEventListener("click", function () {
        metadataTruncationDismissed = true;
        renderTruncationBanner();
      });
    }

    $("pager-prev").addEventListener("click", function () {
      if (contentPage > 1) {
        contentPage--;
        renderContentList();
      }
    });
    $("pager-next").addEventListener("click", function () {
      var filtered = getFilteredRows();
      var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (contentPage < pages) {
        contentPage++;
        renderContentList();
      }
    });

    sidebarCollapsed = readSidebarCollapsedPreference();
    applySidebarCollapsedState();
    var sidebarToggle = $("sidebar-toggle");
    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", toggleSidebarCollapsed);
    }

    attachContentListKeyboard();
    attachHelpModal();
    syncDependentFilterUI();
    renderTruncationBanner();
    renderContentList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
