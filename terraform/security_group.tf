# Depends on: data.tf (data.aws_vpc.default), variables.tf
# (var.ssh_allowed_cidr, var.project_name).
# Depended on by: ec2.tf (vpc_security_group_ids).

resource "aws_security_group" "web" {
  name_prefix = "${var.project_name}-web-"
  description = "SSH from a fixed CIDR, HTTP/HTTPS from anywhere"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_allowed_cidr]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-web"
  }

  lifecycle {
    create_before_destroy = true
  }
}
