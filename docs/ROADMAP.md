# Roadmap

Ordered by what protects a live stream, then revenue.

1. **Field proof.** Two real phones on two carriers, SRT then SRTLA, real Twitch/Kick/YouTube at once, glass to glass latency, an 8 hour soak, OBS killed mid-stream. Publish the numbers and a drive-test video.
2. **Hot standby OBS.** A second OBS on a second server receiving the same feeds, with the relay switching between programs. Removes the restart gap the crash shield currently covers with BRB, and survives a whole server dying.
3. **Warm pool.** Pre-booted servers per region with images pulled, assigned to a tenant on start and configured at runtime. Start in seconds.
4. **Multi-region ingest.** Choose the region nearest the streamer; latency is added on the cloud hop.
5. **Per-link bonding stats.** RTT, loss and throughput per SIM from the SRTLA receiver on the dashboard.
6. **Usage billing.** Report metered hours to Stripe, plans with included hours, overage.
7. **WebRTC (WHIP) ingest.** Stream from a phone browser with no app, for guests and backups.
8. **Overlay and scene editor** in the portal: upload BRB, low signal and branding art.
9. **Kick and YouTube chat control** alongside Twitch.
10. **Team accounts** with roles beyond the single moderator token.
11. **GPU tier** after NVENC is proven.
12. **Vertical output** for Shorts, Reels and TikTok Live from the same stream.

Done in v0.3: backup encoder failover, SRT-aware switching, multistream relay with isolated reconnects, crash shield, broadcast auto-recover, live rules, moderator role, one-time SSE tickets, crew alerts, QR setup, prebuilt images, readiness checks, sslip and Cloudflare DNS, orphan sweeper, CI with Docker end to end.
