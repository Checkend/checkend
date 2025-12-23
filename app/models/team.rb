class Team < ApplicationRecord
  extend FriendlyId
  friendly_id :name, use: :slugged

  belongs_to :owner, class_name: 'User'
  has_many :team_members, dependent: :destroy
  has_many :users, through: :team_members
  has_many :team_assignments, dependent: :destroy
  has_many :apps, through: :team_assignments
  has_many :team_invitations, dependent: :destroy

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: true

  def should_generate_new_friendly_id?
    name_changed? || slug.blank?
  end
end
