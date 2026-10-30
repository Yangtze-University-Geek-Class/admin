
### 界面精简（2026-10-23）：软件包仓库和依赖项代理没人用，整站关掉，组侧栏不再显示「部署」。
gitlab_rails['packages_enabled'] = false
gitlab_rails['dependency_proxy_enabled'] = false

### 默认用户头像：同站 NANO 头像池按邮箱/用户名的 SHA-256 稳定分配，已上传头像优先。
### 前缀读 /etc/gitlab/yzgc-gitlab-url（本环境的 GITLAB_URL，#335），头像由香港入口在 <GITLAB_URL>/nano-avatar/ 下直接给。
gitlab_rails['gravatar_enabled'] = true
gitlab_rails['gravatar_plain_url'] = File.read('/etc/gitlab/yzgc-gitlab-url').strip + '/nano-avatar/20261025/%{hash}?s=%{size}'
gitlab_rails['gravatar_ssl_url'] = File.read('/etc/gitlab/yzgc-gitlab-url').strip + '/nano-avatar/20261025/%{hash}?s=%{size}'
