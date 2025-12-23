class TeamMember < ApplicationRecord
  belongs_to :team
  belongs_to :user

  validates :role, inclusion: { in: %w[admin member] }
  validates :team_id, uniqueness: { scope: :user_id }

  scope :admin, -> { where(role: 'admin') }
  scope :member, -> { where(role: 'member') }

  def admin?
    role == 'admin'
  end

  def member?
    role == 'member'
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
