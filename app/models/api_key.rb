class ApiKey < ApplicationRecord
  has_secure_token :key

  validates :name, presence: true
  validates :permissions, presence: true
  validate :permissions_format

  scope :active, -> { where(revoked_at: nil) }
  scope :revoked, -> { where.not(revoked_at: nil) }

  def has_permission?(permission)
    return false unless active?
    permissions.include?(permission.to_s)
  end

  def has_any_permission?(*permission_list)
    return false unless active?
    permission_list.any? { |perm| has_permission?(perm) }
  end

  def revoke!
    update!(revoked_at: Time.current)
  end

  def active?
    revoked_at.nil?
  end

  def touch_last_used_at!
    update_column(:last_used_at, Time.current)
  end

  private

  def permissions_format
    return if permissions.blank?

    unless permissions.is_a?(Array)
      errors.add(:permissions, 'must be an array')
      return
    end

    unless permissions.all? { |p| p.is_a?(String) }
      errors.add(:permissions, 'must contain only strings')
    end
  end
end

