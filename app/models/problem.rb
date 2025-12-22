class Problem < ApplicationRecord
  belongs_to :app
  has_many :notices, dependent: :destroy

  validates :error_class, presence: true
  validates :fingerprint, presence: true, uniqueness: { scope: :app_id }

  scope :unresolved, -> { where(status: 'unresolved') }
  scope :resolved, -> { where(status: 'resolved') }

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

  def self.generate_fingerprint(error_class, _error_message, location)
    # Group by error class + location, not message (messages can vary)
    Digest::SHA256.hexdigest("#{error_class}|#{location}")
  end
end
