class ProblemTag < ApplicationRecord
  belongs_to :problem
  belongs_to :tag

  validates :problem_id, uniqueness: { scope: :tag_id }
end
