class Problem < ApplicationRecord
  belongs_to :app
  has_many :notices, dependent: :destroy
  has_many :problem_tags, dependent: :destroy
  has_many :tags, through: :problem_tags

  validates :error_class, presence: true
  validates :fingerprint, presence: true, uniqueness: { scope: :app_id }

  scope :unresolved, -> { where(status: 'unresolved') }
  scope :resolved, -> { where(status: 'resolved') }
  scope :last_seen_after, ->(date) { where('last_noticed_at >= ?', date.beginning_of_day) if date.present? }
  scope :last_seen_before, ->(date) { where('last_noticed_at <= ?', date.end_of_day) if date.present? }
  scope :with_notices_at_least, ->(count) { where('notices_count >= ?', count) if count.present? && count.to_i > 0 }
  scope :tagged_with, ->(tag_names) {
    return all if tag_names.blank?

    tag_list = Array(tag_names).map(&:downcase)
    joins(:tags).where(tags: { name: tag_list }).distinct
  }

  def unresolved?
    status == 'unresolved'
  end

  def resolved?
    status == 'resolved'
  end

  def resolve!
    update!(status: 'resolved', resolved_at: Time.current)
  end

  def unresolve!
    update!(status: 'unresolved', resolved_at: nil)
  end

  def total_occurrences
    notices_count + deduplicated_count
  end

  def self.generate_fingerprint(error_class, _error_message, location)
    # Group by error class + location, not message (messages can vary)
    Digest::SHA256.hexdigest("#{error_class}|#{location}")
  end

  def occurrence_chart_data(days: 30)
    start_date = days.days.ago.beginning_of_day
    counts = notices.where('occurred_at >= ?', start_date)
                    .group_by_day(:occurred_at)
                    .count

    # Fill in zeros for missing days
    (start_date.to_date..Date.current).each_with_object({}) do |date, hash|
      hash[date] = counts[date] || 0
    end
  end

  def as_json(options = {})
    super(options).merge(
      'id' => id,
      'app_id' => app_id,
      'error_class' => error_class,
      'error_message' => error_message,
      'fingerprint' => fingerprint,
      'status' => status,
      'notices_count' => notices_count,
      'first_noticed_at' => first_noticed_at&.iso8601,
      'last_noticed_at' => last_noticed_at&.iso8601,
      'resolved_at' => resolved_at&.iso8601,
      'created_at' => created_at&.iso8601,
      'updated_at' => updated_at&.iso8601,
      'tags' => tags.map { |t| { id: t.id, name: t.name } }
    )
  end
end
