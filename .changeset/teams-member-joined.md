---
"@chat-adapter/teams": minor
---

Dispatch Teams `conversationUpdate` members-added activities as `onMemberJoinedChannel` events, covering users joining a team or group chat and the bot itself being installed in personal, group chat, or team scope. `TeamsAdapter.botUserId` now returns the bot's Teams account id (`28:<app id>`) so handlers can detect their own installation the same way as on Slack. Member-joined events now carry the platform payload as `raw` on both Slack and Teams.
