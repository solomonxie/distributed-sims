# Depends on: eip.tf (aws_eip.app), variables.tf (key_name).
# Depended on by: nothing in Terraform — this is the bridge to
# `ansible-playbook`, which reads the file it writes.

resource "local_file" "ansible_inventory" {
  filename = "${path.module}/../ansible/inventory.ini"
  content = templatefile("${path.module}/templates/inventory.ini.tftpl", {
    host     = aws_eip.app.public_ip
    key_name = var.key_name
  })
}
