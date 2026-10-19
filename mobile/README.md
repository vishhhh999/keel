# Keel mobile

Expo (React Native, TypeScript) companion app. Connects to a Keel controller, shows the live state with the tilting mark, and gives scene, auto-switching and go-live controls. Polls `/api/status` once a second with exponential backoff on failure.

```
npm install
npm test          # logic and client tests
npm run typecheck
npx expo start    # scan with Expo Go
```

Status: logic and client are unit tested and the project type-checks. It has not been run on a physical device yet. Release builds: `eas build` after setting bundle ids in `app.json`.
