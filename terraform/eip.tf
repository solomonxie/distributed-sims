# Depends on: ec2.tf (aws_instance.app).
# Depended on by: inventory.tf, outputs.tf.
#
# Keeps a stable public IP across stop/start so the generated ansible
# inventory doesn't go stale between runs.

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = {
    Name = var.project_name
  }
}
