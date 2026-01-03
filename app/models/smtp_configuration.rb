class SmtpConfiguration < ApplicationRecord
  encrypts :password

  validates :address, presence: true, if: :enabled?
  validates :port, presence: true, if: :enabled?
  validates :port, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 65_535 }, if: :enabled?
  validates :user_name, presence: true, if: :enabled?
  validates :password, presence: true, if: :enabled?
  validates :authentication, inclusion: { in: %w[plain login cram_md5] }, if: :enabled?

  # Singleton pattern - ensure only one record exists
  before_create :ensure_singleton
  before_destroy :prevent_destroy_if_last

  def self.instance
    first_or_create!(enabled: false)
  end

  private

  def ensure_singleton
    if SmtpConfiguration.exists?
      errors.add(:base, 'Only one SMTP configuration is allowed')
      throw(:abort)
    end
  end

  def prevent_destroy_if_last
    # Allow destroy, but we'll handle singleton in application logic
    # This is a safety check
  end
end
