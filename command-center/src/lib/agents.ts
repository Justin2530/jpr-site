// JPR Local's AI team (Justin 2026-11-11: "name them, list their job titles, responsibilities and have a tab
// for them in my command center so i can click in there and see who does what"). Names are his to change on
// the AI team page (agent_names table); everything else here describes what the code in lib/ actually does.
// When an agent is added or changes jobs, update its entry here.

export type Agent = {
  key: string;
  name: string; // default until Justin renames it
  title: string;
  team: "Recruiting" | "Clients" | "Front desk" | "Inbox & messages" | "Sales";
  does: string[];
  when: string;
  never: string[];
  seeIt?: { label: string; href: string };
  brain: string;
  code: string;
  feeds?: string[]; // agents this one hands work to (drawn as links on the map)
};

export const AGENTS: Agent[] = [
  {
    key: "jarvis",
    feeds: ["screening", "relay", "reception", "brain", "lead_engine"],
    name: "Jarvis",
    title: "Chief of Staff",
    team: "Front desk",
    does: [
      "Your own assistant: text or call (814) 845-4341 from your cell, or open Jarvis in the Command Center to type or talk.",
      "Answers any question about the business by reading the whole Command Center: clients, jobs, candidates, messages, calls, the pipeline and what every other agent has done.",
      "Does what you tell it: texts and emails people, assigns candidates, moves stages, flips automation switches, books AI screening calls, adds tasks.",
      "Before every action it reads it back (\"J. P., to confirm, you want me to ...\") and acts only after you say confirm.",
    ],
    when: "Whenever you text it (start with \"Jarvis\"), call the main line from your cell, or use the Jarvis page.",
    never: [
      "Acts without your confirm.",
      "Deletes anything, spends money, publishes the website, or touches WellThree.",
      "Talks to anyone but you unless you confirm a text or email.",
    ],
    seeIt: { label: "Jarvis", href: "/jarvis" },
    brain: "OpenAI GPT-5 mini (thinking) + GPT-Live (voice)",
    code: "lib/jarvis.ts, lib/jarvis-call.ts",
  },
  {
    key: "reception",
    feeds: ["messenger"],
    name: "Ava",
    title: "Receptionist",
    team: "Front desk",
    does: [
      "Answers the business line (814) 845-4341 when your cell doesn't pick up (after 9pm, before 8am, or unanswered).",
      "Covers all four businesses: JPR Local, JPR USA, JPR AI and the Job Board.",
      "Finds out who's calling and why, answers questions about public job openings, and greets known clients and candidates by name.",
      "Takes messages and voicemails and leaves you a call-back task with a summary.",
    ],
    when: "Every call to the main line that you don't answer.",
    never: ["Shares private or confidential jobs, client names, other candidates or internal notes.", "Quotes anything that isn't in her brief."],
    seeIt: { label: "What needs me", href: "/" },
    brain: "OpenAI GPT-Live (voice)",
    code: "lib/reception.ts",
  },
  {
    key: "messenger",
    name: "Max",
    title: "Messenger",
    team: "Front desk",
    does: [
      "Passes any non-candidate message or voicemail from the business line to your cell.",
      "8am to 9pm your cell rings and the message is read out (or lands in your voicemail); overnight it comes as a text.",
    ],
    when: "Whenever someone leaves a message with the Receptionist.",
    never: ["Contacts anyone but you."],
    brain: "Twilio voice (no AI decisions)",
    code: "lib/cell-alert.ts",
  },
  {
    key: "triage",
    name: "Sage",
    title: "Gatekeeper",
    team: "Inbox & messages",
    does: [
      "Reads every new text and email and decides whether it actually needs you.",
      "Clears thank-yous, confirmations, FYIs and auto-replies from What needs me.",
      "Leaves everything that needs your decision with a one-line reason why.",
    ],
    when: "Every new message.",
    never: ["Replies to anyone. It only sorts."],
    seeIt: { label: "What needs me", href: "/" },
    brain: "OpenAI gpt-5-mini",
    code: "lib/triage.ts",
  },
  {
    key: "conversations",
    name: "Casey",
    title: "Conversation Tracker",
    team: "Inbox & messages",
    does: [
      "Re-reads each active conversation when a new message lands.",
      "Sorts it into Waiting on you or Current on the Messages page.",
    ],
    when: "Every minute, for conversations active in the last 30 days.",
    never: ["Sends messages."],
    seeIt: { label: "Messages", href: "/messages" },
    brain: "OpenAI gpt-5-mini",
    code: "lib/conversations.ts",
  },
  {
    key: "third_eye",
    feeds: ["brain"],
    name: "Third Eye",
    title: "Inbox Assistant",
    team: "Inbox & messages",
    does: [
      "Reads every new email in your Gmail (Indeed first, but from anywhere).",
      "Picks out possible candidates, adds them, and works out which job they mean.",
      "Drafts answers to their questions from that job's facts.",
    ],
    when: "Every minute, as new mail comes in.",
    never: [
      "Recruits: no outreach, texts or calls start until you put someone on a job and choose to automate.",
      "Sends replies on its own unless you turn on automatic replies in Settings; until then they wait for your OK.",
      "Touches client emails or candidates already in automated recruiting.",
    ],
    seeIt: { label: "What needs me", href: "/" },
    brain: "OpenAI gpt-5-mini",
    code: "lib/third-eye.ts",
  },
  {
    key: "brain",
    feeds: ["screening"],
    name: "Riley",
    title: "Recruiting Assistant",
    team: "Recruiting",
    does: [
      "Reads each candidate's reply to outreach and decides the next step.",
      "Books the screening call when they give a time (\"Tuesday at 11\" means 11am).",
      "Answers questions about pay, hours and location; anything it can't answer goes to you.",
    ],
    when: "When a candidate in automated screening replies by text or email.",
    never: [
      "Works on anyone unless all three switches are on (master, the job, the candidate).",
      "Names the client company before the screening call.",
    ],
    seeIt: { label: "Messages", href: "/messages" },
    brain: "OpenAI gpt-5-mini",
    code: "lib/brain.ts",
  },
  {
    key: "job_intake",
    feeds: ["screening"],
    name: "Drew",
    title: "Job Intake",
    team: "Recruiting",
    does: [
      "Turns a pasted job description into a job: title, company, location, pay, schedule and screening questions.",
    ],
    when: "When you paste a job description on the Jobs page.",
    never: ["Saves anything until you review and save the job."],
    seeIt: { label: "Jobs", href: "/jobs" },
    brain: "OpenAI gpt-5-mini",
    code: "lib/job-parse.ts",
  },
  {
    key: "screening",
    feeds: ["call_watch", "writeup"],
    name: "Morgan",
    title: "Screening Recruiter",
    team: "Recruiting",
    does: [
      "Calls candidates at their booked time and runs the short screening call.",
      "Asks the job's screening questions and answers theirs from the job's facts.",
      "Leaves a voicemail and texts them when they don't pick up.",
      "Says it's your AI assistant if asked.",
    ],
    when: "At each booked screening time.",
    never: ["Calls anyone unless all three switches are on.", "Talks offer terms."],
    seeIt: { label: "Calendar", href: "/calendar" },
    brain: "OpenAI GPT-Live (voice)",
    code: "lib/screening.ts, lib/live.ts",
  },
  {
    key: "call_watch",
    name: "Hank",
    title: "Call Monitor",
    team: "Recruiting",
    does: [
      "Stays on every AI screening call in the background.",
      "Hangs up a few seconds after the goodbye, after long dead air, or at 16 minutes (the voice AI can't hang up itself).",
      "Keeps the call moving when the voice AI says \"let me note that\", and logs what happened.",
    ],
    when: "During every AI screening call.",
    never: ["Speaks to the candidate."],
    brain: "No AI decisions",
    code: "lib/call-watch.ts",
  },
  {
    key: "resume",
    feeds: ["writeup"],
    name: "Parker",
    title: "Resume Formatter",
    team: "Recruiting",
    does: [
      "Lays out each candidate's resume on JPR letterhead (\"[Name] - JPR.pdf\").",
      "Checks every word against the original so nothing is lost or added, and flags anything that doesn't match.",
    ],
    when: "When a resume is added to a candidate.",
    never: ["Changes the candidate's words. It only reformats, and the original file is always kept."],
    seeIt: { label: "Candidates", href: "/candidates" },
    brain: "OpenAI gpt-5-mini",
    code: "lib/resume-brand.ts",
  },
  {
    key: "writeup",
    feeds: ["relay"],
    name: "Quinn",
    title: "Submission Writer",
    team: "Recruiting",
    does: [
      "Transcribes each finished screening call.",
      "Writes the call notes and screening answers onto the candidate's job tab.",
      "Drafts the client submission in your style for you to Send, Edit, Hold or Pass.",
    ],
    when: "Right after each screening call ends.",
    never: ["Sends a submission. Every one waits for your click."],
    seeIt: { label: "What needs me", href: "/" },
    brain: "OpenAI Whisper + gpt-5-mini",
    code: "lib/screening.ts, lib/submission.ts",
  },
  {
    key: "relay",
    name: "Jordan",
    title: "Client Coordinator",
    team: "Clients",
    does: [
      "After you send a submission, follows up with a quiet client.",
      "Carries interview scheduling back and forth between the client and the candidate.",
      "Sends reminders and check-ins around the interview.",
      "Hands every offer, pass, counteroffer or anything odd to you, and turns that candidate's automation off.",
    ],
    when: "After a submission is sent, for candidates with all three switches on.",
    never: ["Sends anything with offer terms without your click.", "Makes a decision for you."],
    seeIt: { label: "Pipeline", href: "/pipeline" },
    brain: "OpenAI gpt-5-mini",
    code: "lib/relay.ts",
  },
  {
    key: "lead_engine",
    name: "Scout",
    title: "Lead Finder",
    team: "Sales",
    does: [
      "Runs the Google Maps searches you queue in Lead Engine.",
      "Reads each business's website for emails and checks them, and looks up PA businesses in the state registry for owner names.",
      "Gives you a CSV of the results.",
    ],
    when: "Every minute while a Lead Engine search is queued.",
    never: ["Contacts any business. It only builds lists.", "Adds national chains."],
    seeIt: { label: "Lead Engine", href: "/leads" },
    brain: "Serper + website reads (no AI decisions)",
    code: "lib/leads.ts",
  },
  {
    key: "registry",
    name: "Atlas",
    title: "Market Researcher",
    team: "Sales",
    does: [
      "Works through the PA business registry for our 8 counties (about 37,000 businesses).",
      "Googles each one, reads its website, and estimates whether it has 4 or more employees.",
      "Saves the phone, website, emails, Facebook, named people and whether they're hiring.",
    ],
    when: "In the background until the master lead list run is finished.",
    never: ["Contacts any business.", "Shows anything in the Command Center until you approve the list."],
    brain: "Bright Data Google search + OpenAI gpt-5-mini",
    code: "lib/registry-research.ts",
  },
];

export const TEAMS: Agent["team"][] = ["Front desk", "Inbox & messages", "Recruiting", "Clients", "Sales"];
