class TeamInvitation < ApplicationRecord
  belongs_to :team
  belongs_to :invited_by, class_name: 'User'

  validates :email, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :token, presence: true, uniqueness: true

  before_validation :generate_token, on: :create
  before_validation :set_expires_at, on: :create

  scope :pending, -> { where(accepted_at: nil) }
  scope :accepted, -> { where.not(accepted_at: nil) }
  scope :expired, -> { where('expires_at < ?', Time.current) }
  scope :active, -> { pending.where('expires_at > ?', Time.current) }

  def accepted?
    accepted_at.present?
  end

  def expired?
    expires_at.present? && expires_at < Time.current
  end

  def active?
    !accepted? && !expired?
  end

  def accept!
    update!(accepted_at: Time.current)
  end

  private

  def generate_token
    self.token ||= SecureRandom.hex(32)
  end

  def set_expires_at
    self.expires_at ||= 7.days.from_now
  end
end
