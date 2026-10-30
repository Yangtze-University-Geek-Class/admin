# 预发布 GitLab 的实例设置、外观和组 geek 与正式对齐（#335）。cutover.sh preview-parity 经
# docker exec -i gitlab-preview gitlab-rails runner - 喂进来，只在预发布实例里跑。
# 目标值是正式实例 2026-10-30 从 API 读到的值；图片是仓库 deploy/gitlab/ui/ 的文件，和正式上传的字节相同。
# YZGC_APPLY=1 才写（图片此前已复制到 /tmp/yzgc-parity/）；否则只列出和目标不同的项。只建组，不建项目、不动成员数据。
# 最后一行是 JSON 摘要：设置值、图片摘要前缀、组的公开字段，不含令牌或口令。
require 'digest'
require 'fileutils'
require 'json'
require 'tmpdir'

apply = ENV['YZGC_APPLY'] == '1'
upload_dir = '/tmp/yzgc-parity'
images = {
  'logo.png' => ENV.fetch('YZGC_LOGO_SHA256'),
  'favicon-32.png' => ENV.fetch('YZGC_FAVICON_SHA256'),
  'group-avatar.png' => ENV.fetch('YZGC_GROUP_AVATAR_SHA256')
}
if apply
  images.each do |name, sha|
    raise "#{name} 复制进容器后摘要不对" unless Digest::SHA256.file(File.join(upload_dir, name)).hexdigest == sha
  end
end

private_level = Gitlab::VisibilityLevel::PRIVATE
settings_target = {
  default_preferred_language: 'zh_CN',
  default_project_visibility: private_level,
  default_group_visibility: private_level,
  enabled_git_access_protocol: 'http',
  default_artifacts_expire_in: '7 days',
  signup_enabled: false,
  usage_ping_enabled: false,
  gravatar_enabled: true
}
appearance_target = {
  title: '长江大学极客班 代码仓库',
  description: '长江大学极客班的代码仓库，用极客班账号登录。',
  pwa_name: '极客班代码仓库',
  pwa_short_name: '极客班仓库',
  pwa_description: '长江大学极客班的代码仓库',
  message_background_color: '#E75E40',
  message_font_color: '#FFFFFF'
}
appearance_images = { logo: 'logo.png', header_logo: 'logo.png', pwa_icon: 'logo.png', favicon: 'favicon-32.png' }
group_target = {
  name: '长江大学极客班',
  description: '长江大学极客班的代码仓库',
  visibility_level: private_level,
  project_creation_level: Gitlab::Access.project_creation_string_options.fetch('developer'),
  subgroup_creation_level: Gitlab::Access.subgroup_creation_string_options.fetch('maintainer'),
  request_access_enabled: true
}

# 上传器缓存时会把源文件移走：/tmp/yzgc-parity 归 root，runner 以 git 用户跑删不掉，所以每次先复制到 runner 自己的临时目录
work = Dir.mktmpdir('yzgc-parity-')
at_exit { FileUtils.remove_entry(work, true) }
upload = ->(name) do
  copy = File.join(work, "#{SecureRandom.hex(4)}-#{name}")
  FileUtils.cp(File.join(upload_dir, name), copy)
  File.open(copy)
end
uploaded = ->(uploader) { uploader.present? ? Digest::SHA256.hexdigest(uploader.read.to_s) : nil }
stale = ->(record, target) { target.reject { |key, value| record.public_send(key) == value }.keys }

root = User.find_by_username('root') or raise '预发布 GitLab 没有 root 账号'
namespace = Namespace.find_by_full_path('geek')
raise 'geek 已被不是组的命名空间占用' if namespace && !namespace.is_a?(Group)

pending = lambda do
  settings = ApplicationSetting.current_without_cache
  appearance = Appearance.first
  group = Group.find_by_full_path('geek')
  list = stale.call(settings, settings_target).map { |key| "settings.#{key}" }
  if appearance
    list += stale.call(appearance, appearance_target).map { |key| "appearance.#{key}" }
    list += appearance_images.reject { |field, name| uploaded.call(appearance.public_send(field)) == images[name] }.keys.map { |field| "appearance.#{field}" }
  else
    list << 'appearance'
  end
  if group
    list += stale.call(group, group_target).map { |key| "group.#{key}" }
    list << 'group.avatar' unless uploaded.call(group.avatar) == images['group-avatar.png']
    list << 'group.root_owner' unless group.owned_by?(root)
  else
    list << 'group'
  end
  list
end

before = pending.call
if apply && before.any?
  ApplicationSetting.current_without_cache.update!(settings_target)

  appearance = Appearance.first || Appearance.new
  appearance.assign_attributes(appearance_target)
  appearance_images.each do |field, name|
    next if uploaded.call(appearance.public_send(field)) == images[name]

    appearance.public_send("#{field}=", upload.call(name))
  end
  appearance.save!

  group = Group.find_by_full_path('geek')
  unless group
    params = { name: group_target[:name], path: 'geek', visibility_level: private_level }
    if defined?(Organizations::Organization) && Organizations::Organization.respond_to?(:default_organization)
      params[:organization_id] = Organizations::Organization.default_organization.id
    end
    result = Groups::CreateService.new(root, params).execute
    group = result.respond_to?(:payload) ? result.payload[:group] : result
    raise "组 geek 建不出来：#{group&.errors&.full_messages&.join('；')}" unless group&.persisted?
  end
  group.assign_attributes(group_target)
  group.avatar = upload.call('group-avatar.png') unless uploaded.call(group.avatar) == images['group-avatar.png']
  group.save!
  group.add_owner(root) unless group.owned_by?(root)
end

settings = ApplicationSetting.current_without_cache
appearance = Appearance.first
group = Group.find_by_full_path('geek')
prefix = ->(uploader) { uploaded.call(uploader)&.slice(0, 8) }
summary = {
  apply: apply,
  pending: before,
  remaining: apply ? pending.call : nil,
  settings: settings_target.keys.to_h { |key| [key, settings.public_send(key)] },
  gitlab_rb: {
    packages_enabled: Gitlab.config.packages.enabled,
    dependency_proxy_enabled: Gitlab.config.dependency_proxy.enabled,
    gravatar_plain_url: Gitlab.config.gravatar.plain_url,
    gravatar_ssl_url: Gitlab.config.gravatar.ssl_url
  },
  appearance: appearance && {
    title: appearance.title,
    images: appearance_images.keys.to_h { |field| [field, prefix.call(appearance.public_send(field))] }
  },
  group: group && {
    id: group.id,
    full_path: group.full_path,
    name: group.name,
    visibility: group.visibility,
    project_creation_level: group.project_creation_level,
    subgroup_creation_level: group.subgroup_creation_level,
    request_access_enabled: group.request_access_enabled,
    root_owner: group.owned_by?(root),
    projects: group.projects.count,
    avatar: prefix.call(group.avatar)
  }
}
puts summary.to_json
