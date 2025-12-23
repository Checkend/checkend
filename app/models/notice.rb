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

  public

  def as_json(options = {})
    {
      'id' => id,
      'problem_id' => problem_id,
      'error_class' => error_class,
      'error_message' => error_message,
      'occurred_at' => occurred_at&.iso8601,
      'created_at' => created_at&.iso8601,
      'updated_at' => updated_at&.iso8601,
      'context' => context || {},
      'request' => request || {},
      'user_info' => user_info || {},
      'notifier' => notifier || {},
      'backtrace' => backtrace&.lines || []
    }
  end
end
