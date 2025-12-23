class TeamAssignment < ApplicationRecord
  belongs_to :team
  belongs_to :app

  validates :team_id, uniqueness: { scope: :app_id }
end

