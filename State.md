[State](./State.md) is the current information [Modules](./Modules.md) share. What you just said, what task is active, an email you just received. Think of it as the shared whiteboard where  [Modules](./Modules.md) write updates that others instantly see. While [Knowledge](./Knowledge.md) stores permanent information, [State](./State.md) holds what's happening right now.

- **Shared state via BroadcastChannel**: When one updates, others instantly know
- **Time-travel debugging**: Full history of changes *(for development)*

```javascript
{
  transcript: { current: "Schedule meeting with John", confidence: 0.98 },
  browser: { activeTab: "calendar.google.com", title: "Google Calendar" },
  user: { speaking: false, lastAction: "2024-01-15T10:30:00Z" },
  modules: {
    calendar: { status: "ready", lastSync: "2024-01-15T10:29:00Z" },
    tasks: { activeCount: 5, nextDue: "2024-01-15T14:00:00Z" }
  }
}
```

