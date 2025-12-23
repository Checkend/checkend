class Team < ApplicationRecord
  belongs_to :owner, class_name: 'User'
  has_many :team_members, dependent: :destroy
  has_many :users, through: :team_members
  has_many :team_assignments, dependent: :destroy
  has_many :apps, through: :team_assignments
  has_many :team_invitations, dependent: :destroy

  validates :name, presence: true
end
