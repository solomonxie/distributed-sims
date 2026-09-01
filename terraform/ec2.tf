# Depends on: data.tf (AMI, subnet), security_group.tf (aws_security_group.web),
# variables.tf (instance_type, root_volume_gb, key_name, project_name).
# Depended on by: eip.tf, inventory.tf, outputs.tf.

resource "aws_instance" "app" {
  ami                         = data.aws_ami.al2023_arm.id
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.web.id]
  key_name                    = var.key_name
  associate_public_ip_address = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    delete_on_termination = true
  }

  tags = {
    Name = var.project_name
  }
}
