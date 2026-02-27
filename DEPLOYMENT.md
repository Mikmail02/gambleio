# Deployment Guide for Gambleio

This guide will help you deploy Gambleio to a free hosting service and connect it to the `gamble.io` domain.

## Prerequisites

- A GitHub account (free)
- Access to purchase/configure `gamble.io` domain (or use a subdomain)
- Git installed on your computer (optional, for command line)

## Option 1: Netlify (Recommended - Easiest)

### Step 1: Prepare Your Code

1. Make sure all your files are in a folder (e.g., `Gambleio/`)
2. Ensure `index.html` is in the root of the project folder

### Step 2: Create GitHub Repository

1. Go to [GitHub.com](https://github.com) and sign in
2. Click the "+" icon in the top right → "New repository"
3. Name it `gambleio` (or any name you prefer)
4. Choose **Public** (required for free hosting)
5. **DO NOT** initialize with README, .gitignore, or license
6. Click "Create repository"

### Step 3: Upload Files to GitHub

**Option A: Using GitHub Web Interface**
1. In your new repository, click "uploading an existing file"
2. Drag and drop all your project files (index.html, css/, js/, etc.)
3. Write commit message: "Initial commit"
4. Click "Commit changes"

**Option B: Using Git Command Line**
```bash
cd c:\Projects\Gambleio
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/gambleio.git
git push -u origin main
```
(Replace `YOUR_USERNAME` with your GitHub username)

### Step 4: Deploy to Netlify

1. Go to [Netlify.com](https://netlify.com)
2. Sign up/login with your GitHub account
3. Click "Add new site" → "Import an existing project"
4. Choose "GitHub" and authorize Netlify
5. Select your `gambleio` repository
6. Netlify will auto-detect settings:
   - **Build command:** Leave empty (no build needed)
   - **Publish directory:** Leave as `/` (root)
7. Click "Deploy site"
8. Wait 1-2 minutes for deployment
9. Your site is now live at `https://random-name-12345.netlify.app`

### Step 5: Connect Custom Domain (gamble.io)

1. In Netlify dashboard, go to your site → "Domain settings"
2. Click "Add custom domain"
3. Enter `gamble.io` (or `www.gamble.io` if you prefer)
4. Netlify will show you DNS records to add

### Step 6: Configure DNS

1. Go to your domain registrar (where you bought gamble.io)
2. Find DNS management / Nameservers section
3. **Option A: Use Netlify Nameservers (Easiest)**
   - In Netlify, copy the nameservers shown (e.g., `dns1.p01.nsone.net`)
   - In your domain registrar, change nameservers to Netlify's
   - Wait 24-48 hours for propagation

4. **Option B: Use DNS Records (If you want to keep your registrar's nameservers)**
   - Add an A record: `@` → Netlify's IP (shown in Netlify dashboard)
   - Add a CNAME record: `www` → `your-site.netlify.app`
   - Wait 24-48 hours for propagation

### Step 7: Enable HTTPS (Automatic)

- Netlify automatically provides free SSL certificates
- Once DNS propagates, HTTPS will be enabled automatically
- Your site will be accessible at `https://gamble.io`

---

## Option 2: Vercel (Alternative)

### Step 1-3: Same as Netlify (GitHub setup)

### Step 4: Deploy to Vercel

1. Go to [Vercel.com](https://vercel.com)
2. Sign up/login with GitHub
3. Click "Add New Project"
4. Import your `gambleio` repository
5. **Framework Preset:** Other
6. **Root Directory:** `./`
7. Click "Deploy"
8. Your site is live at `https://gambleio.vercel.app`

### Step 5: Connect Domain

1. Go to Project Settings → Domains
2. Add `gamble.io`
3. Follow DNS instructions (similar to Netlify)

---

## Option 3: GitHub Pages (Simplest, but limited)

### Step 1: Enable GitHub Pages

1. Go to your repository on GitHub
2. Settings → Pages
3. Source: "Deploy from a branch"
4. Branch: `main` / `root`
5. Click "Save"
6. Your site will be at `https://YOUR_USERNAME.github.io/gambleio`

### Step 2: Custom Domain

1. In Pages settings, add custom domain: `gamble.io`
2. Configure DNS:
   - Add A records: `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Add CNAME: `www` → `YOUR_USERNAME.github.io`
3. Enable "Enforce HTTPS" after DNS propagates

---

## Domain Setup Details for gamble.io

### If you already own gamble.io:

1. **Go to your domain registrar** (GoDaddy, Namecheap, etc.)
2. **Find DNS Management**
3. **Add these records:**

   **For Netlify:**
   ```
   Type: A
   Name: @
   Value: 75.2.60.5
   
   Type: CNAME
   Name: www
   Value: your-site.netlify.app
   ```

   **For Vercel:**
   ```
   Type: A
   Name: @
   Value: 76.76.21.21
   
   Type: CNAME
   Name: www
   Value: cname.vercel-dns.com
   ```

   **For GitHub Pages:**
   ```
   Type: A
   Name: @
   Value: 185.199.108.153
   Type: A
   Name: @
   Value: 185.199.109.153
   Type: A
   Name: @
   Value: 185.199.110.153
   Type: A
   Name: @
   Value: 185.199.111.153
   
   Type: CNAME
   Name: www
   Value: YOUR_USERNAME.github.io
   ```

### If you need to buy gamble.io:

1. Check availability at domain registrars:
   - [Namecheap.com](https://namecheap.com)
   - [GoDaddy.com](https://godaddy.com)
   - [Google Domains](https://domains.google)
2. Purchase the domain (usually $10-15/year)
3. Follow DNS setup above

---

## Post-Deployment Checklist

- [ ] Site loads at custom domain
- [ ] HTTPS is enabled (green lock icon)
- [ ] All pages work (Home, Plinko, Roulette)
- [ ] Login/signup works
- [ ] Profile page works
- [ ] Games function correctly
- [ ] Mobile responsive (test on phone)

---

## Troubleshooting

### Site shows "Site not found"
- Wait 24-48 hours for DNS propagation
- Check DNS records are correct
- Verify nameservers if using Netlify nameservers

### HTTPS not working
- Wait for DNS to fully propagate
- In Netlify/Vercel, check SSL certificate status
- May take up to 24 hours after DNS is correct

### Changes not updating
- Push new commits to GitHub
- Netlify/Vercel auto-deploys on push
- Check deployment logs in dashboard

---

## Cost Summary

- **Hosting:** FREE (Netlify/Vercel/GitHub Pages)
- **Domain:** ~$10-15/year (gamble.io)
- **SSL Certificate:** FREE (automatic)
- **Total:** ~$10-15/year

---

## Need Help?

- Netlify Docs: https://docs.netlify.com
- Vercel Docs: https://vercel.com/docs
- GitHub Pages Docs: https://docs.github.com/pages
