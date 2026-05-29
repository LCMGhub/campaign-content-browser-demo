/**
 * Synthetic dataset for the public demo (no Domo). Column names mirror the production app.
 */
(function (global) {
  "use strict";

  var clients = [
    { id: "state_university", label: "State University" },
    { id: "liberal_arts_college", label: "Liberal Arts College" },
    { id: "community_college", label: "Community College" },
  ];

  function emailHtml(preheader, body) {
    return (
      '<div class="preheader" style="display:none">' +
      preheader +
      "</div>" +
      body
    );
  }

  var rows = [
    {
      assetContentId: "e_apply_cycle",
      campaignName: "Apply Cycle — Welcome",
      contentHtml: emailHtml(
        "Your application deadline is approaching.",
        "<p><strong>Apply today</strong> — finish your profile and submit supporting documents.</p><p><a href=\"#\">Complete application</a></p>"
      ),
      fromEmail: "admissions@stateu.edu",
      fromName: "Undergraduate Admissions",
      subject: "Complete your application today",
      partition: "state_university",
      campaignYear: 25,
      programSolution: "Enrollment",
    },
    {
      assetContentId: "e_apply_reminder",
      campaignName: "Apply Cycle — Reminder",
      contentHtml: emailHtml(
        "Reminder: application materials due soon.",
        "<p>We have not received all required items. Log in to your applicant portal to upload transcripts.</p>"
      ),
      fromEmail: "admissions@stateu.edu",
      fromName: "Undergraduate Admissions",
      subject: "Reminder: materials still needed",
      partition: "state_university",
      campaignYear: 25,
      programSolution: "Enrollment",
    },
    {
      assetContentId: "lp_apply_landing",
      campaignName: "Apply Cycle — Landing",
      contentHtml:
        "<h1>Apply to State University</h1><p>Start your journey with programs across six colleges.</p><button type=\"button\">Start application</button>",
      partition: "state_university",
      campaignYear: 25,
      programSolution: "Enrollment",
    },
    {
      assetContentId: "e_visit_day",
      campaignName: "Visit Day Invite",
      contentHtml: emailHtml(
        "Join us on campus this spring.",
        "<p>Reserve your spot for Spring Visit Day — tours, sessions, and lunch on us.</p>"
      ),
      fromEmail: "visit@stateu.edu",
      fromName: "Campus Visits",
      subject: "You're invited: Spring Visit Day",
      partition: "state_university",
      campaignYear: 26,
      programSolution: "Yield",
    },
    {
      assetContentId: "lp_visit_day",
      campaignName: "Visit Day Landing",
      contentHtml:
        "<h1>Spring Visit Day</h1><p>Meet faculty, explore residence halls, and ask questions at our student fair.</p>",
      partition: "state_university",
      campaignYear: 26,
      programSolution: "Yield",
    },
    {
      assetContentId: "e_scholarship_nurture",
      campaignName: "Scholarship Nurture",
      contentHtml: emailHtml(
        "Merit awards may be available for you.",
        "<p>Based on your academic profile, you may qualify for merit scholarships. Review your personalized estimate.</p>"
      ),
      fromEmail: "financialaid@stateu.edu",
      fromName: "Financial Aid",
      subject: "Your scholarship estimate is ready",
      partition: "state_university",
      campaignYear: 26,
      programSolution: "Financial Aid",
    },
    {
      assetContentId: "e_liberal_welcome",
      campaignName: "Discovery Series — Welcome",
      contentHtml: emailHtml(
        "Welcome to our discovery email series.",
        "<p>Over the next few weeks we will share stories from current students and faculty mentors.</p>"
      ),
      fromEmail: "hello@liberalarts.edu",
      fromName: "Enrollment Team",
      subject: "Welcome to Liberal Arts College",
      partition: "liberal_arts_college",
      campaignYear: 25,
      programSolution: "Nurture",
    },
    {
      assetContentId: "e_liberal_essay_tip",
      campaignName: "Discovery Series — Essay Tips",
      contentHtml: emailHtml(
        "Three tips for a memorable personal essay.",
        "<ol><li>Start with a specific moment.</li><li>Show growth, not just achievement.</li><li>Ask someone you trust to read a draft.</li></ol>"
      ),
      fromEmail: "hello@liberalarts.edu",
      fromName: "Enrollment Team",
      subject: "Essay workshop: tips from our readers",
      partition: "liberal_arts_college",
      campaignYear: 25,
      programSolution: "Nurture",
    },
    {
      assetContentId: "lp_liberal_programs",
      campaignName: "Programs Overview",
      contentHtml:
        "<h1>Find your program</h1><p>Explore 40+ majors in the arts, sciences, and professional studies.</p>",
      partition: "liberal_arts_college",
      campaignYear: 25,
      programSolution: "Awareness",
    },
    {
      assetContentId: "e_liberal_deposit",
      campaignName: "Deposit Campaign",
      contentHtml: emailHtml(
        "Secure your place in the Class of 2030.",
        "<p>Submit your enrollment deposit by May 1 to confirm housing preferences and orientation dates.</p>"
      ),
      fromEmail: "enroll@liberalarts.edu",
      fromName: "New Student Programs",
      subject: "Confirm your enrollment",
      partition: "liberal_arts_college",
      campaignYear: 26,
      programSolution: "Yield",
    },
    {
      assetContentId: "lp_liberal_deposit",
      campaignName: "Deposit Landing",
      contentHtml:
        "<h1>Confirm enrollment</h1><p>We are excited to welcome you. Complete your deposit in a few minutes.</p>",
      partition: "liberal_arts_college",
      campaignYear: 26,
      programSolution: "Yield",
    },
    {
      assetContentId: "e_cc_open_house",
      campaignName: "Open House Invite",
      contentHtml: emailHtml(
        "Visit campus and meet our advisors.",
        "<p>Join us for Open House — program tables, financial aid sessions, and a campus tour.</p>"
      ),
      fromEmail: "recruit@ccdistrict.edu",
      fromName: "Community College Recruitment",
      subject: "Open House this Saturday",
      partition: "community_college",
      campaignYear: 25,
      programSolution: "Recruitment",
    },
    {
      assetContentId: "lp_cc_open_house",
      campaignName: "Open House Landing",
      contentHtml:
        "<h1>Open House</h1><p>Register for sessions, parking, and your guided tour time slot.</p>",
      partition: "community_college",
      campaignYear: 25,
      programSolution: "Recruitment",
    },
    {
      assetContentId: "e_cc_transfer",
      campaignName: "Transfer Pathways",
      contentHtml: emailHtml(
        "Plan your transfer with guided pathways.",
        "<p>See articulation agreements and recommended courses for popular four-year partners.</p>"
      ),
      fromEmail: "transfer@ccdistrict.edu",
      fromName: "Transfer Services",
      subject: "Your transfer pathway guide",
      partition: "community_college",
      campaignYear: 26,
      programSolution: "Transfer",
    },
    {
      assetContentId: "e_cc_fafsa",
      campaignName: "FAFSA Reminder",
      contentHtml: emailHtml(
        "Complete the FAFSA to unlock aid options.",
        "<p>Our financial aid team can help you file — book a 15-minute virtual appointment.</p>"
      ),
      fromEmail: "fafsa@ccdistrict.edu",
      fromName: "Financial Aid Office",
      subject: "FAFSA filing support available",
      partition: "community_college",
      campaignYear: 26,
      programSolution: "Financial Aid",
    },
    {
      assetContentId: "lp_cc_apply",
      campaignName: "Apply Now",
      contentHtml:
        "<h1>Apply in three steps</h1><p>Create an account, choose your term, and upload transcripts.</p>",
      partition: "community_college",
      campaignYear: 26,
      programSolution: "Enrollment",
    },
  ];

  rows.forEach(function (row) {
    row.contentName = row.campaignName;
  });

  global.CCB_DEMO_DATA = {
    clients: clients,
    rows: rows,
  };
})(typeof window !== "undefined" ? window : globalThis);
