class Notice < ApplicationRecord
  belongs_to :problem, counter_cache: true
  belongs_to :backtrace, optional: true

  validates :error_class, presence: true

  before_validation :set_occurred_at, on: :create
  after_create :update_problem_timestamps

  private

  def set_occurred_at
    self.occurred_at ||= Time.current
  end

  def update_problem_timestamps
    attrs = { last_noticed_at: occurred_at }
    attrs[:first_noticed_at] = occurred_at if problem.first_noticed_at.nil?
    problem.update_columns(attrs)
  end
end
