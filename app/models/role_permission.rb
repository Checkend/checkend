class RolePermission < ApplicationRecord
  ROLES = %w[owner admin developer member viewer].freeze

  belongs_to :permission

  validates :role, presence: true, inclusion: { in: ROLES }
  validates :permission_id, uniqueness: { scope: :role }

  scope :for_role, ->(role) { where(role: role) }

  # Returns all permission keys for a given role
  def self.permissions_for(role)
    for_role(role).includes(:permission).map { |rp| rp.permission.key }
  end

  # Check if a role has a specific permission
  def self.role_has_permission?(role, permission_key)
    joins(:permission).exists?(role: role, permissions: { key: permission_key })
  end
end
