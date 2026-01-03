class TeamMember < ApplicationRecord
  ROLES = %w[owner admin developer member viewer].freeze

  belongs_to :team
  belongs_to :user

  validates :role, inclusion: { in: ROLES }
  validates :team_id, uniqueness: { scope: :user_id }

  scope :owners, -> { where(role: 'owner') }
  scope :admins, -> { where(role: %w[owner admin]) }
  scope :developers, -> { where(role: %w[owner admin developer]) }
  scope :members, -> { where(role: 'member') }
  scope :viewers, -> { where(role: 'viewer') }

  # Legacy scopes for backwards compatibility
  scope :admin, -> { where(role: %w[owner admin]) }
  scope :member, -> { where(role: 'member') }

  # Role hierarchy: owner > admin > developer > member > viewer
  ROLE_HIERARCHY = {
    'owner' => 5,
    'admin' => 4,
    'developer' => 3,
    'member' => 2,
    'viewer' => 1
  }.freeze

  def owner?
    role == 'owner'
  end

  def admin?
    role.in?(%w[owner admin])
  end

  def developer?
    role.in?(%w[owner admin developer])
  end

  def member?
    role == 'member'
  end

  def viewer?
    role == 'viewer'
  end

  def role_level
    ROLE_HIERARCHY[role] || 0
  end

  def can_manage?(other_member)
    role_level > other_member.role_level
  end

  def as_json(options = {})
    {
      'id' => id,
      'team_id' => team_id,
      'user_id' => user_id,
      'role' => role,
      'user' => user&.as_json&.except('password_digest'),
      'created_at' => created_at&.iso8601,
      'updated_at' => updated_at&.iso8601
    }
  end
end
