# Terraform

Provisions one ARM (Graviton, `t4g.micro`) EC2 instance in the account's
default VPC — 20GB gp3 root disk, a security group open on 22 (restricted)
/80/443, and a stable Elastic IP — to host the built React app behind
nginx. EC2 is the only thing we provision right now, so it's one file;
split it back out per-resource if this grows.

```
terraform apply
  ├─ variables.tf → resolve inputs (region, instance size, key pair, SSH CIDR)
  └─ main.tf      → provider, AMI/VPC/subnet lookups, security group,
                     the instance, its Elastic IP, and the ansible
                     inventory bridge file — see its own header comment
                     for the build order within it
        │
        ▼
outputs.tf → prints the public IP / SSH command
        │
        ▼
ansible-playbook -i ../ansible/inventory.ini ../ansible/playbook.yml
  (installs nginx, deploys the local `dist/` build as the web root)
```

## Usage

```
terraform init
terraform apply \
  -var="key_name=<your existing EC2 key pair name>" \
  -var="ssh_allowed_cidr=<your IP>/32"
```

`key_name` and `ssh_allowed_cidr` have no defaults on purpose — you must
consciously supply an existing key pair and a real CIDR, never
`0.0.0.0/0`, for SSH.

`terraform destroy` tears everything back down; this stack has no
auto-terminate timer (it's meant to be a standing host, not a throwaway
sandbox).
