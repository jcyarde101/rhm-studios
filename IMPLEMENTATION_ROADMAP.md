# RHM Studios implementation roadmap

## Definition of “working”

RHM Studios is working when a signed-in user can upload a 15–30 minute StreamYard recording, begin reviewing a fast proxy and transcript, guide and approve every creative decision, render a polished long-form video, approve written deliverables and clips, and download a StreamYard-ready package. Refreshing the browser must not lose any work.

## Current state

### Implemented

- Responsive RHM Studios and RHM Publications interfaces
- Human-approval workflow prototype
- Private environment configuration
- Successful authentication checks for OpenAI, Runway, Claude, Gemini, and Supabase
- Supabase schema migrations with row-level security
- RHM logo, intro, and outro source assets
- Reusable brand-media catalog

### Not yet implemented

- Application server and authenticated user sessions
- Applied Supabase migrations and verified Storage policies
- Real video upload or resumable upload
- Persistent projects, decisions, drafts, and approvals
- Media validation, proxy creation, transcription, or rendering
- Real OpenAI, Runway, Claude, Gemini, or image-generation calls
- Real preview playback of proposed edits
- StreamYard-ready export packaging

## Build sequence and acceptance gates

### 1. Application foundation

- Create the TypeScript application server.
- Validate environment variables without logging secrets.
- Add health checks for Supabase and configured AI providers.
- Add structured error handling and audit-safe logs.

**Accepted when:** the server starts, reports healthy dependencies, and exposes no secret values to the browser.

### 2. Supabase foundation

- Install the Supabase CLI.
- Link the existing Supabase project.
- Review and push all migrations.
- Verify tables, row-level security, and private Storage buckets.
- Add email/password or magic-link authentication.

**Accepted when:** two test users cannot read or modify each other’s projects or media.

### 3. Real upload pipeline

- Create resumable uploads directly to private Supabase Storage.
- Validate file type and size server-side.
- Create the devotional project record.
- Display real upload progress, pause/resume, and recovery.

**Accepted when:** a 30-minute MP4 survives refresh or a temporary connection interruption and appears only in its owner’s workspace.

### 4. Fast-start media processing

- Install FFmpeg/FFprobe on the worker.
- Inspect codec, resolution, audio, duration, and loudness.
- Extract audio immediately.
- Generate a 540p review proxy, waveform, thumbnails, and poster frame.
- Run full-quality preparation in the background.

**Accepted when:** transcript and proxy review can begin before the original 1080p preparation finishes.

### 5. Transcript and message direction

- Transcribe audio with timestamps and speaker segmentation.
- Make transcript paragraphs seekable in the proxy player.
- Support transcript corrections and message-direction notes.
- Persist approval and change-request history.

**Accepted when:** a corrected transcript and approved message brief survive sign-out and sign-in.

### 6. Written deliverables

- Produce structured drafts for short description, full devotional, prayer, scripture list, and social captions.
- Use the transcript plus the user’s message direction.
- Save versions rather than overwriting earlier drafts.
- Require separate approval for every deliverable.
- Send only approved devotional material to RHM Publications.

**Accepted when:** each item can be edited, regenerated with guidance, compared to earlier versions, and approved independently.

### 7. Editorial plan and previews

- Detect pauses, mistakes, scene changes, scripture mentions, and strong moments.
- Propose—not automatically apply—cuts, audio treatment, B-roll, scripture cards, lower-thirds, music, logo, intro, and outro.
- Use Runway for approved generative video treatments or B-roll where appropriate.
- Use OpenAI GPT Image for user-directed still graphics and backgrounds.
- Use deterministic timeline rendering for text, captions, logos, and assembly.

**Accepted when:** every proposed edit has a preview, replace/reject controls, and an approval record.

### 8. Full-video render

- Assemble approved edits with a timeline renderer and FFmpeg.
- Apply approved RHM intro, outro, logo, scripture overlays, B-roll, music, transitions, color, and audio mix.
- Preserve the original source unchanged.
- Render a review copy before the final master.

**Accepted when:** the user can watch the complete review render, request changes, and approve a revised render.

### 9. Social clips

- Propose timestamped clip candidates only after message direction is approved.
- Support selection, rejection, trimming, caption editing, framing, and platform choice.
- Render approved 9:16 clips with safe-area captions and RHM branding.

**Accepted when:** each exported clip matches its approved preview and has an editable caption.

### 10. Final export package

- Export the master as MP4, H.264, AAC, up to 1080p, at a StreamYard-compatible bitrate.
- Include thumbnail, short description, full devotional, prayer, scripture list, captions, and approved clips.
- Provide “Copy for StreamYard” and individual download controls.
- Do not automatically publish.

**Accepted when:** the MP4 uploads successfully as a StreamYard prerecorded broadcast and the description can be pasted without reformatting.

## Processing architecture

Runway is not the complete timeline editor. It should generate or enhance approved visual elements. FFmpeg plus a deterministic timeline renderer should perform cuts, audio mixing, scripture text, captions, logo placement, intro/outro assembly, and final encoding. This makes the approved preview reproducible in the final export.

Long-running work must run as background jobs. The browser starts or approves jobs and observes progress; it must not keep a single web request open for a 15–30 minute video render.

## Deferred until the video workflow passes

- Autonomous production agent
- Suno-powered RHM Music Studio
- Automatic social publishing
- StreamYard browser automation
- Multi-user teams and advanced billing

