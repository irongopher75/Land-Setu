# Public Pilot HTTPS / TLS Deployment Guide

This document outlines the three recommended deployment patterns for TLS/HTTPS termination on Land-Setu in a public pilot environment.

---

## Option 1: Cloudflare Flexible / Full SSL (Recommended for Fast Deployment)
If deploying to a domain managed by Cloudflare:
1. Proxy your domain (`A` record pointing to public server IP).
2. Set Cloudflare SSL/TLS encryption mode to **Full (Strict)** or **Full**.
3. Generate a free **Cloudflare Origin CA Certificate** and save it locally to:
   - `./nginx/certs/fullchain.pem`
   - `./nginx/certs/privkey.pem`
4. Nginx automatically listens on port `443 ssl http2` using these certificates and handles rate limiting, HSTS (`Strict-Transport-Security`), and header sanitization.

---

## Option 2: Nginx + Certbot (Standard Let's Encrypt Setup)
If deploying on a VPS (AWS EC2, GCP Compute Engine, DigitalOcean Droplet):
1. Point your DNS `A` record (`landsetu.yourdomain.gov.in`) to the server IP.
2. Run Certbot to issue certificates:
   ```bash
   sudo certbot certonly --webroot -w /var/www/certbot -d landsetu.yourdomain.gov.in
   ```
3. Symlink or copy the generated certificates into `./nginx/certs/`:
   ```bash
   ln -s /etc/letsencrypt/live/landsetu.yourdomain.gov.in/fullchain.pem ./nginx/certs/fullchain.pem
   ln -s /etc/letsencrypt/live/landsetu.yourdomain.gov.in/privkey.pem ./nginx/certs/privkey.pem
   ```
4. Restart docker compose: `docker-compose up -d --build`

---

## Option 3: Caddy Reverse Proxy (Zero-Config Automatic HTTPS)
If preferring automatic Let's Encrypt renewal without certbot cronjobs, create a `Caddyfile`:

```caddy
landsetu.yourdomain.gov.in {
    # Forward API calls to backend
    handle /api/* {
        uri strip_prefix /api
        reverse_proxy backend:8000
    }

    # Forward all UI traffic to frontend
    handle {
        reverse_proxy frontend:80
    }
}
```
Run Caddy alongside docker-compose to achieve automatic TLS certificate provisioning and renewal.
