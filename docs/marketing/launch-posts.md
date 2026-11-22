# Ateva beta launch posts (drafts)

Rules for every post:

- Posted from Harshit's own accounts, first person, founder affiliation stated.
- No sockpuppets, no asking friends to upvote, no cross-posting the same text.
- No earnings claims. Rewards are off in the beta; say so.
- Reply to every comment within the first few hours. Replies matter more than the post.
- Check the live URL works before any post goes out.

Placeholders: `{SITE}` = public site URL, `{INSTALL}` = how to get the CLI / VS Code extension.

---

## X / Twitter (developers)

Thread, posted from founder account. Best Tue-Thu, 9-11am US Eastern.

**1/**
I timed my Claude Code and Codex sessions for a week. A lot of my day is staring at a spinner while an agent works.

So I built Ateva: during those waits, VS Code shows one small sponsored card. The plan is that developers get a share of what advertisers pay.

**2/**
It's in private beta, and rewards are switched off for now.

Reason: I can't yet prove to an advertiser that a wait was real without trusting the client. Until an independent attestation piece exists, nobody gets billed and nobody gets paid. I'd rather say that up front.

**3/**
What it sends: the tool type (claude, codex...) and start/stop timing.
What it never sends: your prompt, the command arguments, or any output.

Telemetry is off by default. Quiet hours and an ads-per-hour cap are built in.

**4/**
`ateva run -- claude` wraps the tool and reports the wait. The VS Code extension does the same from the editor.

Looking for devs who use AI agents daily to try it and tell me where wait detection gets it wrong.

{SITE}

**5/** (optional, reply to own thread)
If you buy developer ads and want an attention slot that isn't a banner next to a docs page, there's a waitlist: {SITE}/advertisers

---

## Reddit

One post per sub, spaced at least a few days apart. Read each sub's rules the day of posting. Text differs per sub on purpose.

### r/SideProject

**Title:** I built a VS Code extension that shows one sponsored card while your AI agent is working (beta, looking for feedback)

**Body:**
Hey all, I'm the solo dev behind this.

Using Claude Code and Codex all day, I noticed how much time goes to waiting on the agent. Ateva detects those waits and shows one small sponsored card in VS Code. The longer-term idea is that developers get a revenue share from advertisers.

Honest status:

- Private beta. Rewards are off. Nobody is paid and no advertiser is billed yet.
- The reason is that I can't yet prove a wait was real without trusting the client, and I don't want to bill on numbers I can't stand behind.
- Telemetry is opt-in. It sends tool type and timing only, never prompts or output.

What I'd love feedback on:

1. Would you install this at all, once it paid? What would make it a no?
2. If you try it: does the wait detection fire when it shouldn't?

{SITE}

### r/alphaandbetausers

**Title:** [Beta] Ateva: wait-time detection for AI coding agents (CLI + VS Code)

**Body:**
What it is: a CLI wrapper (`ateva run -- <tool>`) and a VS Code extension that detect when you're waiting on an AI coding agent. During a wait it can show one sponsored card. Rewards for developers are planned but off during beta.

Who I need: people who run Claude Code, Codex, or similar for a few hours a day.

What testers do: install, use your agent as normal for a few days, and report false positives (a "wait" that wasn't one) with the built-in report button.

Privacy: off by default. Only tool type and timing are sent. Never prompts, args, or output.

I'm the developer. Happy to answer anything here.

{SITE}

---

## Hacker News

Post only when someone can sign up and install without talking to you. Show HN needs something people can try now.
Post Tue-Thu, roughly 8-10am US Eastern. Stay in the thread for 3+ hours.

**Title:** Show HN: Ateva – sponsored cards during AI agent waits, with a payout you can't fake yet

**URL:** {SITE}

**First comment (post right after submitting):**
Hi HN, I'm Harshit, I built this.

AI coding agents leave you waiting for anywhere from seconds to minutes. Ateva detects those waits (a CLI wrapper, `ateva run -- claude`, plus a VS Code extension) and can show one sponsored card during them. The goal is to pass a share of advertiser spend to the developer.

The hard part, and why rewards are off in the beta: a wait reported by a client on your machine can be faked. A device-held signing key doesn't prove an unmodified client saw a real wait. So settlement is fail-closed. Nothing is billed and nothing is paid until there's an independently verifiable attestation in the loop. I'm still working out what that should look like and would welcome ideas.

What's sent: normalized tool type and lifecycle timing. Not the prompt, args, or output. Telemetry is off by default.

Things I'd like pushback on:

- Is ads-in-the-editor a line you won't cross at any price?
- How would you attest a wait without trusting the client?

---

## Research, 2026-11-01

Competitors already in this exact slot:

- **Kickbacks** (kickbacks.ai): sponsored line replaces "thinking…" in Claude Code, ~50% net revenue share, pays now. Got wide X and HN attention. Breakdown thread with real payout reports ($0.43/workday, $4.43 for 3h): https://x.com/rimtoln/status/2109228871975321915 (108 likes, 56 replies).
- **Idlen**: ads in the IDE and AI chats, self-serve ads manager. HN post 2026-08-30, little traction.

Implication: "ads during AI waits" is not new to this audience. Ateva's angle is the one Kickbacks can't claim: an impression is billed only when the wait can be proven without trusting the client, and no prompt data leaves the machine. Lead with that, especially to advertisers.

HN: no live thread worth joining (best match, "Ask HN: How do you kill time while LLMs work for you?", is from 2026-09-10 with 3 comments). Hold HN for the Show HN.

## Reply drafts

### X: reply to the Kickbacks breakdown (rimtoln)

Disclosure: I'm building in this space (Ateva).

The hard part is #1's "counts after 10s". The advertiser only has the client's word that a wait happened.

Our beta pays nothing yet for that reason: no billing until a wait can be proven without trusting the client.
