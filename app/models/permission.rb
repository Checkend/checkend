class Permission < ApplicationRecord
  has_many :role_permissions, dependent: :destroy
  has_many :user_permissions, dependent: :destroy
  has_many :record_permissions, dependent: :destroy

  validates :key, presence: true, uniqueness: true,
                  format: { with: /\A[a-z_]+:[a-z_]+\z/, message: 'must be in format resource:action' }
  validates :resource, presence: true
  validates :action, presence: true

  scope :for_resource, ->(resource) { where(resource: resource) }
  scope :system_permissions, -> { where(system: true) }

  def self.find_by_key!(key)
    find_by!(key: key)
  end

  def to_s
    key
  end
end
