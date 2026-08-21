# Deploying Voice-Enabled RAG (VOX·RAG) to Vercel

Here is the step-by-step guide to deploying your application to Vercel.

---

## Method 1: Deploy via GitHub (Recommended — 2 Minutes)

### Step 1: Push your code to GitHub
Make sure all your latest code (including `data/embeddings.json` and the new UI) is committed and pushed to your repository:
```bash
git add .
git commit -m "feat: complete voice-enabled rag pipeline with VOX-RAG UI"
git push origin main
```

---

### Step 2: Import into Vercel
1. Go to [https://vercel.com](https://vercel.com) and log in.
2. Click **"Add New..."** $\rightarrow$ **"Project"**.
3. Select your GitHub repository.
4. Vercel will automatically detect **TanStack Start / Vite**.

---

### Step 3: Configure Environment Variables
Under the **Environment Variables** section in Vercel, add the following 4 keys:

| Key | Value | Description |
|---|---|---|
| `GEMINI_API_KEY` | `your_gemini_api_key` | Google Gemini API key for embeddings & Flash LLM |
| `ELEVENLABS_API_KEY` | `your_elevenlabs_key` | ElevenLabs API key for server token proxy |
| `VITE_ELEVENLABS_API_KEY` | `your_elevenlabs_key` | ElevenLabs publishable key for browser WebSocket STT/TTS |
| `VITE_ELEVENLABS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` | Default multilingual voice ID |

---

### Step 4: Click Deploy 🚀
1. Click the **Deploy** button.
2. Vercel will run `npm run build` and provision your live URL (e.g. `https://your-project.vercel.app`).

---

## Method 2: Deploy via Vercel CLI

If you have the Vercel CLI:

```bash
# 1. Login to Vercel
npx vercel login

# 2. Deploy to preview
npx vercel

# 3. Add environment variables
npx vercel env add GEMINI_API_KEY
npx vercel env add ELEVENLABS_API_KEY
npx vercel env add VITE_ELEVENLABS_API_KEY
npx vercel env add VITE_ELEVENLABS_VOICE_ID

# 4. Deploy to Production
npx vercel --prod
```
