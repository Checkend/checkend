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
end

