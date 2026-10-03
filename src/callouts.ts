/**
 * The canned callouts the bot posts. Each one is a template: `{user}` is
 * replaced by a mention of the message's poster. Keep them snarky but
 * professional: a colleague's raised eyebrow, never an insult.
 */
export const callouts: readonly string[] = [
  "{user}, did you read this before you pasted it, or are we both finding out now?",
  "Thanks {user}. Which parts of this do you personally stand behind?",
  "{user}, this has the unmistakable glow of text nobody has read yet. Could you give it a once-over?",
  "{user}, quick check: is this your take, or the model's first draft?",
  "Appreciate the volume, {user}. Could we get the part you actually read?",
  "{user}, a human summary of this would go a long way. Yours, ideally.",
  "{user}, bold of you to forward this without proofreading. Mind taking a pass?",
  "Friendly nudge, {user}: pasting it is step one. Reading it is step two.",
  "{user}, before we all dig in, can you confirm this says what you meant?",
  "{user}, I'm sure the model meant well. What do *you* think it says?",
  "Hi {user}, this reads like it skipped the human review step. Want to add one?",
  "{user}, TL;DR please, in your own words. The model already had its turn.",
  "{user}, a gentle reminder that we can talk to the chatbot ourselves. We're here for you.",
  "Noted, {user}. Which of these points should we take seriously?",
  "{user}, raising an eyebrow here. Did this get a read on the way through?",
  "{user}, you are now the proud author of this message. Worth a quick read, no?",
  "{user}, eyes on this one? Or should we treat it as a draft for now?",
  "Real talk, {user}: did you believe what you just pasted?",
  "{user}, between us, how much of this did you actually understand?",
  "Genuine question, {user}: would you say the same thing if you had to write it yourself?",
  "{user}, looks like something got lost in translation. Want to clarify?",
  "Check this out: <https://nomeatproxy.com|no meat proxy>. But first, {user}, what's your read on this?",
  "{user}, I see a wall of text. I also see you. Which one came first?",
  "Pardon me, {user}, but has this actually been through a human pass? Asking for the team.",
  "{user}, not to be *that* person, but reading is fundamental. Care to try?",
  "Quick sanity check, {user}: do you agree with all of this, or are you just sharing?",
  "{user}, I'm sensing this might be a copy-paste situation. A summary would help.",
  "Hold on, {user}. Is this something you believe in, or just passing along?",
  "{user}, verbose! Could we get the CliffsNotes version in your own words?",
  "This feels like it needs a {user} quality pass. Interested?",
  "Fair warning, {user}: uninvited AI text gets scrutinized here. What's your take on it?",
  "<https://nomeatproxy.com|No meat proxy> aside, {user}, can you back this up in your own words?",
  "{user}, I'm going to gently suggest: read, *then* share. In that order?",
  "Thoughtful of you to share, {user}. Now, what do *you* think about it?",
  "{user}, here's the thing: we trust your judgment. So show us yours?",
  "Plot twist, {user}: the human perspective is actually the one we're missing here.",
  "{user}, verbosity level: maximum. Clarity level: unclear. Care to translate?",
  "Question for you, {user}: if you had to defend every word in this, could you?",
  "Okay {user}, I'll bite. What does this mean to you, specifically?",
  "Noticed something, {user}: the model speaks, we listen. But what do *you* say?",
  "Time for a reality check, {user}: does this represent your actual thinking?",
  "{user}, would love your editorial comment. The unfiltered version.",
  "Interesting choice, {user}. Before we run with it, do you endorse it?",
  "Friendly FYI, {user}: <https://nomeatproxy.com|nomeatproxy.com> is great, but your voice is better. Use it?",
  "{user}, I see the copy-paste. I also see your name on the message. Thoughts?",
  "{user}, this reads like a first draft. A {user}-edited version would be chef's kiss.",
];

/** Replaces every `{user}` in a template with a Slack mention of `userId`. */
export function renderCallout(template: string, userId: string): string {
  return template.replaceAll("{user}", `<@${userId}>`);
}

// Last template index picked per channel. In memory and best-effort: it is
// lost on restart and not shared between instances, which is fine for
// avoiding back-to-back repeats.
const lastPicked = new Map<string, number>();

/**
 * Picks a random callout template for a channel, never the same one twice in
 * a row for that channel (as long as there are at least two templates).
 * `rng` returns a number in [0, 1), like Math.random, and is injectable for
 * tests.
 */
export function pickCallout(
  channelId: string,
  rng: () => number = Math.random,
): string {
  const last = lastPicked.get(channelId);
  let index: number;
  if (last === undefined || callouts.length < 2) {
    index = randomIndex(rng, callouts.length);
  } else {
    // Draw from the other templates only, so the choice stays uniform.
    index = randomIndex(rng, callouts.length - 1);
    if (index >= last) index += 1;
  }
  lastPicked.set(channelId, index);
  return callouts[index] ?? "";
}

function randomIndex(rng: () => number, size: number): number {
  return Math.min(Math.floor(rng() * size), size - 1);
}
