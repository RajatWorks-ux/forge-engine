# FORGE Phase 1 — Complete Setup Guide
# Every step. Every click. Every screen. Nothing skipped.
# Total time: ~2 hours first time.
# Do every step in ORDER. Skip nothing.
# ============================================================

## WHAT YOU NEED BEFORE STARTING
- Your Realme Pad 2 with Termux installed
- Internet connection
- Your ElevenLabs API key (get free at elevenlabs.io)
- Your Nebius API key (get free at nebius.ai — required for NVIDIA hackathon)
- The FORGE_PHASE1 folder extracted from the zip

## WHERE IS THE FORGE_PHASE1 FOLDER?
After extracting the zip, you will have a folder called FORGE_PHASE1.
It contains:
  src/                  ← FORGE pipeline code
  forge-web/            ← Next.js web app (this folder)
  .github/workflows/    ← GitHub Actions render worker
  package.json          ← FORGE dependencies
  LICENSE
  .gitignore

---

## STEP 1 — SUPABASE SETUP
## (The database that stores jobs and serves videos)
## Time: ~25 minutes

### 1.1 — Create Supabase account
1. Open browser on your tablet
2. Go to: https://supabase.com
3. Click the green "Start your project" button (top right)
4. Click "Sign up with GitHub"
   → If you don't have GitHub yet, skip to STEP 2 first, then come back here
5. A popup asks you to authorize Supabase → click "Authorize supabase"
6. You land on the Supabase dashboard (shows "Welcome to Supabase")

### 1.2 — Create your project
1. Click the green "New project" button
2. You'll see a form. Fill in:
   - Organization: your username (auto-filled, leave it)
   - Name: forge-engine
   - Database Password: type something strong like "Forge#2026$Engine"
     ⚠️ SAVE THIS PASSWORD SOMEWHERE — you'll need it if you ever reset
   - Region: Southeast Asia (Singapore)
     → Click the dropdown, find "Southeast Asia (Singapore)", click it
3. Click the green "Create new project" button
4. You see a loading screen that says "Setting up your project"
5. WAIT — this takes 1-2 minutes. Don't refresh.
6. When it finishes, you'll see your project dashboard

### 1.3 — Run the SQL setup (creates the jobs table)
1. Look at the LEFT SIDEBAR (vertical menu on the left side)
2. Find the icon that looks like a database with angle brackets: click it
   It says "SQL Editor" when you hover over it
3. Click "New query" button (top right of the SQL editor area)
4. You'll see a big empty text area where you type SQL
5. Now open the file: FORGE_PHASE1/forge-web/SUPABASE_SETUP.sql
   In Termux: cat forge-web/SUPABASE_SETUP.sql
   Or open it in any text editor on your tablet
6. SELECT ALL the text in that file (every single line from top to bottom)
7. COPY it
8. Go back to your browser with Supabase SQL editor open
9. Click inside the empty text area
10. PASTE the SQL (long press → paste, or Ctrl+V)
11. Click the green "RUN" button at the bottom right
    (or press Ctrl+Enter)
12. At the bottom of the screen you should see:
    "Success. No rows returned."
    → If you see an error like "already exists" → that's fine, continue
    → If you see a different error → screenshot it and tell me

### 1.4 — Create the video storage bucket
1. Left sidebar → look for the box/storage icon
   It says "Storage" when you hover
2. Click "Storage"
3. Click "New bucket" button (top right)
4. A small form appears. Fill in:
   - Name: forge-videos
     ⚠️ TYPE EXACTLY: forge-videos (lowercase, with hyphen, no spaces)
   - Public bucket: toggle this to ON (it turns green/blue)
   - File size limit: leave as is
5. Click "Create bucket"
6. You should now see "forge-videos" listed under Buckets

### 1.5 — Set bucket CORS policy (so videos play in browser)
1. Click on "forge-videos" bucket
2. Click the "Configuration" tab (or gear icon)
3. Look for "CORS Configuration" or "Allowed origins"
4. If you see it, set:
   - Allowed origins: *
   - Allowed methods: GET
5. Save
   → If you don't see CORS settings, skip this — public buckets work by default

### 1.6 — Get your 3 API keys (SAVE ALL OF THESE)
1. Left sidebar → scroll to the very bottom
2. Click the gear icon at the bottom — it says "Settings"
3. In the Settings submenu that appears, click "API"
4. You'll see a page with multiple keys. Find and COPY these 3:

   KEY 1 — Project URL
   Looks like: https://abcdefghijkl.supabase.co
   Copy the whole URL exactly

   KEY 2 — anon public key
   Label says "anon" or "public"
   Starts with: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   It's the SHORTER of the two long keys

   KEY 3 — service_role key
   Label says "service_role"
   Also starts with eyJ...
   It's the LONGER of the two long keys
   ⚠️ NEVER share this key with anyone — it has full database access

Save all 3 somewhere safe. You need them in Steps 2.6 and 3.2.

---

## STEP 2 — GITHUB SETUP
## (Where your code lives + runs the render server)
## Time: ~30 minutes

### 2.1 — Create GitHub account (skip if you have one)
1. Go to: https://github.com
2. Click "Sign up" (top right)
3. Enter your email → click "Continue"
4. Create a password → click "Continue"
5. Enter a username (e.g. rajatworks-dev) → click "Continue"
6. Solve the puzzle → click "Create account"
7. Check your email → enter the verification code
8. Answer the questions or click "Skip personalization"
9. You're now on the GitHub dashboard

### 2.2 — Create the repository
1. Click the "+" icon at the TOP RIGHT of GitHub
2. Click "New repository"
3. Fill in the form:
   - Owner: your username (already filled)
   - Repository name: forge-engine
   - Description: AI Code-Rendered Video Engine — every frame is code
   - Visibility: ⚠️ Select PUBLIC (free GitHub Actions only work on public repos)
   - Initialize: Leave ALL checkboxes UNCHECKED
     (no README, no .gitignore, no license — we have our own)
4. Click the green "Create repository" button
5. You'll see a page with setup instructions
6. COPY the URL shown — it looks like:
   https://github.com/YOUR_USERNAME/forge-engine.git
   SAVE THIS URL

### 2.3 — Create Personal Access Token (your password for pushing code)
1. Click your profile photo (circle, top right of GitHub)
2. Click "Settings" from the dropdown
3. Scroll ALL THE WAY DOWN the left sidebar
4. Click "Developer settings" (very last item)
5. Click "Personal access tokens"
6. Click "Fine-grained tokens"
7. Click "Generate new token" (green button)
8. Fill in the form:
   - Token name: forge-deploy
   - Expiration: 90 days (select from dropdown)
   - Resource owner: your username
   - Repository access: Click "Only select repositories"
     → A dropdown appears → click it → find "forge-engine" → select it
9. Scroll down to "Permissions"
   Find and set these (click the dropdown next to each):
   - Repository permissions:
     → Actions: Read and write
     → Contents: Read and write
     → Secrets: Read and write
   Leave everything else as "No access"
10. Scroll to bottom → click "Generate token" (green button)
11. ⚠️ A green box appears with your token. COPY IT RIGHT NOW.
    It starts with: github_pat_
    This is shown ONLY ONCE. If you close the page, it's gone forever.
    SAVE IT in your notes immediately.

### 2.4 — Install git in Termux (if not already installed)
Open Termux and run:
```bash
pkg update -y
pkg install git -y
git --version
```
Should show something like: git version 2.x.x

### 2.5 — Configure git with your info
In Termux:
```bash
git config --global user.name "Rajat Kumar Dua"
git config --global user.email "your-email@gmail.com"
git config --global credential.helper store
```
Replace with your actual name and the email you used for GitHub.

### 2.6 — Find the FORGE_PHASE1 folder in Termux
When you extracted the zip, it created FORGE_PHASE1 folder.
Find it:
```bash
# Try these one by one until one works:
ls ~/FORGE_PHASE1
ls ~/storage/downloads/FORGE_PHASE1
ls ~/storage/shared/Download/FORGE_PHASE1

# Or search for it:
find ~ -name "pipeline.js" 2>/dev/null
```
Note down the full path. Let's call it YOUR_FORGE_PATH.

### 2.7 — Push FORGE code to GitHub
In Termux:
```bash
# Go into FORGE_PHASE1 folder
cd YOUR_FORGE_PATH
# (replace YOUR_FORGE_PATH with the actual path from step 2.6)

# Initialize git
git init

# Add ALL files
git add .

# First commit
git commit -m "FORGE Phase 1 — AI code-rendered video engine"

# Connect to your GitHub repo
# ⚠️ Replace YOUR_USERNAME with your actual GitHub username
git remote add origin https://github.com/YOUR_USERNAME/forge-engine.git

# Set branch name to main
git branch -M main

# Push to GitHub
git push -u origin main
```

When git asks:
- Username: your GitHub username
- Password: PASTE YOUR TOKEN from Step 2.3 (not your GitHub password)

If it succeeds, you'll see:
"Branch 'main' set up to track remote branch 'main' from 'origin'."

### 2.8 — Verify everything is on GitHub
1. Go to: https://github.com/YOUR_USERNAME/forge-engine
2. You should see all your files listed (src/, forge-web/, .github/, etc.)
3. Click the "Actions" tab at the top
4. You should see "FORGE Render Pipeline" listed on the left side
5. If you see a yellow banner that says "Workflows aren't being run" →
   Click "I understand my workflows, go ahead and enable them"

### 2.9 — Add GitHub Secrets (API keys for the render server)
1. On your GitHub repo page, click "Settings" tab (last tab in the top row)
2. In the LEFT SIDEBAR, find "Secrets and variables"
3. Click the arrow to expand it
4. Click "Actions"
5. You'll see "Repository secrets" section
6. Click "New repository secret" button

HOW TO ADD ONE SECRET — do this for EVERY item in the list below:
  a. Click "New repository secret"
  b. In "Name" field: type the secret name EXACTLY as shown
  c. In "Secret" field: paste the value
  d. Click "Add secret" (green button)
  e. You'll see it appear in the list with a lock icon
  f. Click "New repository secret" again for the next one

ADD EVERY ONE OF THESE SECRETS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECRET 1:
Name:   SUPABASE_URL
Value:  https://xxxxxxxx.supabase.co   ← your Project URL from Step 1.6

SECRET 2:
Name:   SUPABASE_SERVICE_KEY
Value:  eyJ...   ← your service_role key from Step 1.6

SECRET 3:
Name:   ELEVENLABS_API_KEY
Value:  your ElevenLabs API key
        Get it: go to elevenlabs.io → sign in → click your profile
        → API Keys → copy the key

SECRET 4:
Name:   FORGE_API_01_KEY
Value:  your Nebius API key
        Get it: go to nebius.ai → sign up → go to API Keys section
        → create a key → copy it

SECRET 5:
Name:   FORGE_API_01_PROVIDER
Value:  nebius

SECRET 6:
Name:   FORGE_API_01_BASE
Value:  https://api.studio.nebius.ai/v1

SECRET 7:
Name:   FORGE_API_01_MODEL
Value:  nvidia/Llama-3.1-Nemotron-70B-Instruct

→ Now repeat secrets 4-7 for slots 02 through 20:
  (You can use the SAME Nebius key for all 20 slots)

SECRET 8:  FORGE_API_02_KEY      → same Nebius key
SECRET 9:  FORGE_API_02_PROVIDER → nebius
SECRET 10: FORGE_API_02_BASE     → https://api.studio.nebius.ai/v1
SECRET 11: FORGE_API_02_MODEL    → nvidia/Llama-3.1-Nemotron-70B-Instruct

SECRET 12: FORGE_API_03_KEY      → same Nebius key
SECRET 13: FORGE_API_03_PROVIDER → nebius
SECRET 14: FORGE_API_03_BASE     → https://api.studio.nebius.ai/v1
SECRET 15: FORGE_API_03_MODEL    → nvidia/Llama-3.1-Nemotron-70B-Instruct

→ Continue this pattern for 04, 05, 06, 07, 08, 09, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20

Total secrets to add: 3 + (20 × 4) = 83 secrets
Yes this is tedious. Yes you have to do all of them.
The more slots, the faster parallel scene generation works.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After adding all secrets, you should see 83 items listed
with lock icons in the "Repository secrets" section.

---

## STEP 3 — VERCEL DEPLOYMENT
## (The website judges will open)
## Time: ~15 minutes

### 3.1 — Create Vercel account
1. Go to: https://vercel.com
2. Click "Sign Up" (top right)
3. Click "Continue with GitHub"
4. A popup asks to authorize Vercel → click "Authorize Vercel"
5. You land on the Vercel dashboard

### 3.2 — Import your project
1. On Vercel dashboard, click "Add New..." button (top right)
2. Click "Project"
3. You'll see a list of your GitHub repositories
4. Find "forge-engine" in the list
5. Click "Import" next to it

### 3.3 — Configure the project
You'll see a "Configure Project" screen. Do this EXACTLY:

1. Project Name: forge-web (or leave default)

2. Framework Preset: Next.js (should auto-detect)

3. Root Directory: ⚠️ THIS IS CRITICAL
   - You'll see a field that says "Root Directory" with a "./" or empty
   - Click the pencil/edit icon next to it
   - Type: forge-web
   - Click the checkmark to confirm
   - The root directory should now show: forge-web

4. Build and Output Settings: leave as default

5. Environment Variables: Click to expand this section
   Add these 6 variables one by one:
   (For each: type the name → tab → paste the value → click "Add")

   ┌─────────────────────────────────┬────────────────────────────────────┐
   │ NAME                            │ VALUE                              │
   ├─────────────────────────────────┼────────────────────────────────────┤
   │ NEXT_PUBLIC_SUPABASE_URL        │ https://xxxxxxxx.supabase.co       │
   │                                 │ (your URL from Step 1.6)           │
   ├─────────────────────────────────┼────────────────────────────────────┤
   │ NEXT_PUBLIC_SUPABASE_ANON_KEY   │ eyJ... (anon key from Step 1.6)    │
   ├─────────────────────────────────┼────────────────────────────────────┤
   │ SUPABASE_SERVICE_KEY            │ eyJ... (service_role from Step 1.6)│
   ├─────────────────────────────────┼────────────────────────────────────┤
   │ GITHUB_TOKEN                    │ github_pat_... (from Step 2.3)     │
   ├─────────────────────────────────┼────────────────────────────────────┤
   │ GITHUB_OWNER                    │ your-github-username               │
   │                                 │ (just the username, not the URL)   │
   ├─────────────────────────────────┼────────────────────────────────────┤
   │ GITHUB_REPO                     │ forge-engine                       │
   └─────────────────────────────────┴────────────────────────────────────┘

6. After adding all 6 variables, click "Deploy" (big black button)

### 3.4 — Wait for deployment
1. You'll see a build log with lines scrolling
2. Wait ~2-3 minutes
3. You should see a green "Congratulations!" page with confetti
4. Click "Continue to Dashboard"
5. On your project dashboard, you'll see your URL:
   Something like: forge-web-abc123.vercel.app
   or: forge-engine.vercel.app
6. COPY THIS URL — this is what judges open

### 3.5 — Test the deployment
1. Open your Vercel URL in the browser
2. You should see the FORGE homepage:
   - Black background
   - 🔥 FORGE logo in green gradient
   - Text area for prompt
   - Style selector cards (7 options)
   - Duration buttons (30s to 20min)
   - Generate button
3. If you see this → deployment successful ✅
4. If you see a white error page → go to Step 5.3 troubleshooting

---

## STEP 4 — npm install (FORGE dependencies)
## Time: ~5 minutes

Before GitHub Actions can run, FORGE needs its package-lock.json
committed so `npm ci` works on the server.

In Termux, inside FORGE_PHASE1:
```bash
# Install dependencies locally first
npm install

# This creates package-lock.json
# Now commit it to GitHub
git add package-lock.json
git commit -m "Add package-lock.json for CI"
git push
```

---

## STEP 5 — TEST END TO END
## (The moment of truth)

### 5.1 — Manual GitHub Actions test first
Before testing via the website, test GitHub Actions directly:
1. Go to: https://github.com/YOUR_USERNAME/forge-engine
2. Click "Actions" tab
3. Click "FORGE Render Pipeline" in the left sidebar
4. Click "Run workflow" button (right side, grey dropdown)
5. Fill in:
   - job_id: job_test_001
   - prompt: How does the Sun produce energy
   - style: cinematic_dark
   - duration: 30
6. Click the green "Run workflow" button
7. Refresh the page after 5 seconds
8. You should see a new workflow run appear (yellow circle = running)
9. Click on it to see the live log

### 5.2 — What the log should show
- Step "Checkout" → ✅ green checkmark
- Step "Setup Node.js 20" → ✅ green
- Step "Install ffmpeg" → ✅ green
- Step "Install dependencies" → ✅ green (may take 2-3 min)
- Step "Install Chrome for Remotion" → ✅ green
- Step "Run FORGE Pipeline" → yellow/spinning (this is where the work happens)
  → Watch the log lines — you should see:
    "FORGE v2 — Job: job_test_001"
    "Stage 0/9 Conducting deep research..."
    "Stage 1/9 Generating video blueprint..."
    etc.
- After 8-15 minutes for 30s video → all steps green ✅

### 5.3 — Check Supabase for results
1. Go to Supabase dashboard
2. Left sidebar → "Table Editor"
3. Click on "jobs" table
4. You should see a row with id = job_test_001
5. Check the columns: status should be "done", video_url should have a URL
6. Copy the video_url and open it in browser → your video plays ✅

### 5.4 — Full end-to-end test via website
1. Open your Vercel URL
2. Type prompt: "How the human brain processes memory"
3. Select style: Particle Cosmos
4. Select duration: 30s
5. Click "Generate Video — 30s"
6. You should be redirected to: yoursite.vercel.app/job/job_XXXXXXXXXX
7. Progress bar shows "Waiting in queue..."
8. After ~60 seconds: progress starts moving
9. Watch each stage update in real time
10. After ~8-10 minutes: video appears and plays automatically

---

## STEP 6 — TROUBLESHOOTING

### Problem: "git push" asks for username and password in a loop
Fix:
```bash
# Set git to remember credentials
git config --global credential.helper store

# Then push again and enter token once
git push -u origin main
# Username: your-github-username
# Password: paste your github_pat_ token
# It will remember after this
```

### Problem: Stuck at 0% for more than 5 minutes
Fix:
1. Go to GitHub → your repo → Actions tab
2. Find the running or failed workflow → click it
3. Click "render" job → read the error
4. Most common causes:
   - Missing secret → go back to Step 2.9
   - npm ci failed → make sure you did Step 4 (package-lock.json)
   - Chrome install failed → retry the workflow

### Problem: "Failed to start render server" immediately on website
Fix:
1. Vercel dashboard → your project → Settings → Environment Variables
2. Check all 6 variables are there
3. Make sure GITHUB_TOKEN value starts with github_pat_
4. Make sure GITHUB_OWNER is just your username (not the full URL)
5. Make sure GITHUB_REPO is exactly: forge-engine
6. After fixing → Vercel → Deployments → click "Redeploy"

### Problem: Pipeline fails at audio stage (ElevenLabs error)
Fix:
1. Go to elevenlabs.io → log in → click your profile photo
2. Click "Profile + API key"
3. Copy your API key
4. Go to GitHub → repo → Settings → Secrets
5. Find ELEVENLABS_API_KEY → click the pencil icon → update the value
6. Retry the workflow

### Problem: Pipeline fails at scene generation (API error)
Fix:
1. Go to nebius.ai → check your API key is active
2. Check you have credits remaining
3. Go to GitHub → repo → Settings → Secrets
4. Find FORGE_API_01_KEY → update it
5. Make sure FORGE_API_01_BASE is exactly: https://api.studio.nebius.ai/v1
6. Retry

### Problem: Video renders but doesn't show on website
Fix:
1. Go to Supabase → Storage → forge-videos
2. Do you see the .mp4 file?
3. If yes → click it → click "Get URL" → copy and open in browser
4. If the video plays → the issue is the frontend not getting the URL
5. Go to Supabase → Table Editor → jobs → find your job → check video_url column
6. If video_url is filled → there's a Realtime subscription issue
   → try refreshing the job page → it should show via polling fallback

### Problem: Vercel build fails
Fix:
1. Vercel dashboard → your project → Deployments tab
2. Click the failed deployment → click "View Build Logs"
3. Look for red error lines
4. Most common: Root Directory not set to forge-web
   → Settings → General → Root Directory → change to forge-web → Save
   → Deployments → Redeploy

---

## STEP 7 — AFTER EVERYTHING WORKS

### Update your README for hackathon submission
In Termux, inside FORGE_PHASE1:
```bash
cat > README.md << 'EOF'
# FORGE — AI Code-Rendered Video Engine

Turn any topic into a cinematic video where every frame is AI-written React code.
No stock footage. No templates. Pure code, rendered to video.

## Live Demo
[forge-engine.vercel.app](https://your-vercel-url.vercel.app)

## How it works
1. You type a topic
2. FORGE researches it (Wikipedia, arXiv, web)
3. AI designs a scene-by-scene blueprint
4. ElevenLabs generates professional narration
5. 16 parallel AI workers write React animation code for every scene
6. Remotion renders the code into MP4 on GitHub Actions
7. Video uploads to Supabase Storage
8. You watch it in the browser

## Tech Stack
- Frontend: Next.js 14 on Vercel
- Database + Storage + Realtime: Supabase
- Render server: GitHub Actions (Ubuntu, 7GB RAM)
- AI: NVIDIA Nemotron on Nebius Token Factory
- Video: Remotion (React → MP4)
- Audio: ElevenLabs

## Built for
- Nebius x NVIDIA Global AI Hackathon (Best Apps & Agents track)
- Arbiter Hacks V1 (General track)

## Local Setup
See SETUP_GUIDE.md for complete instructions.
EOF

git add README.md
git commit -m "Update README for hackathon"
git push
```

---

## FINAL CHECKLIST — DO NOT SUBMIT WITHOUT CHECKING ALL

- [ ] Supabase project exists with jobs table and forge-videos bucket
- [ ] GitHub repo is PUBLIC at github.com/YOUR_USERNAME/forge-engine
- [ ] All 83 GitHub Secrets are added
- [ ] .github/workflows/render.yml is visible in the repo
- [ ] Vercel URL shows FORGE homepage
- [ ] Manual GitHub Actions test completed successfully (Step 5.1)
- [ ] At least one video generated and plays in browser
- [ ] Download button works
- [ ] LICENSE file is in the GitHub repo (MIT)
- [ ] README.md updated with live demo URL
- [ ] package-lock.json is committed (Step 4)

---
