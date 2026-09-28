#!/usr/bin/env bash
# Manual equivalent of ansible/roles/webserver — for reference, not execution.

# tasks/main.yml: install nginx
sudo dnf install -y nginx

# tasks/main.yml: web root
sudo mkdir -p /var/www/distributed-debug
sudo chown nginx:nginx /var/www/distributed-debug

# tasks/main.yml: deploy site config
sudo cp distributed-debug.conf.j2 /etc/nginx/conf.d/distributed-debug.conf
sudo systemctl reload nginx

# tasks/main.yml: sync built app (run `make build` locally first)
rsync -az --delete ./dist/ ec2-user@<host>:/var/www/distributed-debug/

# tasks/main.yml: enable + start nginx
sudo systemctl enable --now nginx
