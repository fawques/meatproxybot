/**
 * The bot's Slack API scopes and their justifications.
 * BOT_SCOPES is the source of truth for:
 * - The bot's OAuth scopes (manifest.yml oauth_config.scopes.bot)
 * - The API methods and events that require each scope
 * - Marketplace submission justifications
 */

export interface ScopeMapping {
  methods: string[];
  events: string[];
  features: string[];
  why: string;
}

export const BOT_SCOPES: Record<string, ScopeMapping> = {
  "chat:write": {
    methods: ["chat.postMessage", "chat.postEphemeral"],
    events: [],
    features: [],
    why: "Posts callout messages in threads and ephemeral feedback to trigger invokers.",
  },
  "reactions:read": {
    methods: ["reactions.get"],
    events: ["reaction_added"],
    features: [],
    why: "Checks if the message was already called out before claiming it, and subscribes to the reaction_added event that triggers callouts.",
  },
  "reactions:write": {
    methods: ["reactions.add", "reactions.remove"],
    events: [],
    features: [],
    why: "Claims called-out messages with the :meat_proxy: reaction, and releases the claim if posting the callout fails.",
  },
  commands: {
    methods: [],
    events: [],
    features: ["slash_commands", "shortcuts"],
    why: "Enables the /meatproxy slash command and the 🥩 Call out meat proxy message shortcut.",
  },
  "channels:history": {
    methods: ["conversations.history", "conversations.replies"],
    events: [],
    features: [],
    why: "Fetches called-out messages from channel history to find their posters. The reaction event and shortcut payload carry the poster for top-level messages, but /meatproxy <link> only has the message link, with no poster or thread_ts. All three triggers use a single fetchMessage function that reads the message to extract its poster and thread.",
  },
  "groups:history": {
    methods: ["conversations.history", "conversations.replies"],
    events: [],
    features: [],
    why: "Fetches called-out messages from private channel history. The same fetchMessage function handles both public and private channels. Group DMs are refused: they trigger missing_scope errors because the bot does not request mpim:history.",
  },
};
