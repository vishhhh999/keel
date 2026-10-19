# Roadmap

Ordered by what protects revenue first.

1. **Pre-built images.** Publish the three images to a registry so a server boots in about a minute instead of building on first start.
2. **Field proof.** Real cellular tests, real platform outputs, latency numbers, a published reliability record.
3. **Orphan sweeper.** A job that lists provider servers and destroys any the database does not know.
4. **Usage billing.** Report metered hours to Stripe. Plans with included hours.
5. **Token hardening.** Rotation, short lived SSE tickets, one time boot secrets for stream keys.
6. **Multi-region.** Choose the region closest to the streamer's ingest.
7. **Overlay and scene editor.** Streamers upload their own BRB and low signal art in the portal.
8. **Alerts.** Push notifications from the mobile app when a drop exceeds a threshold.
9. **Team accounts.** Managers and moderators with limited roles.
10. **GPU tier.** After NVENC is proven, a premium plan for heavier scenes.
