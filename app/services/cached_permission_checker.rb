# Cached version of PermissionChecker for improved performance
#
# Caches permission check results to avoid repeated database queries.
# Cache is automatically invalidated after CACHE_TTL.
#
# Usage:
#   checker = CachedPermissionChecker.new(user)
#   checker.can?('apps:read', record: app)
#
#   # Invalidate cache when permissions change
#   checker.invalidate_cache!
#
class CachedPermissionChecker < PermissionChecker
  CACHE_TTL = 5.minutes

  attr_reader :cache_store

  def initialize(user, cache_store: Rails.cache)
    super(user)
    @cache_store = cache_store
  end

  def can?(permission_key, record: nil, team: nil)
    return false unless user

    # Site admins bypass caching (always true)
    return true if user.site_admin?

    cache_key = build_cache_key(permission_key, record, team)

    cache_store.fetch(cache_key, expires_in: CACHE_TTL) do
      super
    end
  end

  # Invalidate all cached permissions for this user
  def invalidate_cache!
    cache_store.delete_matched("permissions:user:#{user.id}:*")
  end

  # Invalidate cache for a specific permission
  def invalidate_permission!(permission_key)
    cache_store.delete_matched("permissions:user:#{user.id}:#{permission_key}:*")
  end

  # Invalidate cache for a specific record
  def invalidate_record!(record)
    cache_store.delete_matched("permissions:user:#{user.id}:*:#{record.class.name}:#{record.id}")
  end

  # Warm the cache by pre-loading common permissions
  def warm_cache!(permission_keys, records: [], teams: [])
    permission_keys.each do |key|
      # Warm global permission
      can?(key)

      # Warm for each record
      records.each { |record| can?(key, record: record) }

      # Warm for each team
      teams.each { |team| can?(key, team: team) }
    end
  end

  private

  def build_cache_key(permission_key, record, team)
    parts = [ 'permissions', 'user', user.id, permission_key ]
    parts << "team:#{team.id}" if team
    parts << "#{record.class.name}:#{record.id}" if record
    parts.join(':')
  end
end
