# Depends on: nothing.
# Depended on by: providers.tf (aws_region), security_group.tf
# (ssh_allowed_cidr), ec2.tf (instance_type, root_volume_gb, key_name),
# inventory.tf (key_name).

variable "aws_region" {
  description = "AWS region to provision in"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Used to tag/name every resource"
  type        = string
  default     = "distributed-debug"
}

variable "instance_type" {
  description = "ARM (Graviton) instance size — t4g.micro is the smallest that's still free-tier eligible with real burstable network bandwidth"
  type        = string
  default     = "t4g.micro"
}

variable "root_volume_gb" {
  description = "Root EBS volume size in GB"
  type        = number
  default     = 20
}

variable "key_name" {
  description = "Name of an existing EC2 key pair (must already exist in this region) — no default, so you consciously pick one"
  type        = string
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to SSH in on port 22 (e.g. \"1.2.3.4/32\") — no default on purpose, never leave this open to 0.0.0.0/0"
  type        = string
}
