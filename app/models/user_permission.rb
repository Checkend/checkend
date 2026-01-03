class UserPermission < ApplicationRecord
  GRANT_TYPES = %w[grant revoke].freeze

  belongs_to :user
  belongs_to :permission
  belongs_to :team, optional: true
  belongs_to :granted_by, class_name: 'User', optional: true

  validates :grant_type, presence: true, inclusion: { in: GRANT_TYPES }
  validates :permission_id, uniqueness: { scope: [ :user_id, :team_id ] }

  scope :grants, -> { where(grant_type: 'grant') }
  scope :revocations, -> { where(grant_type: 'revoke') }
  scope :active, -> { where('expires_at IS NULL OR expires_at > ?', Time.current) }
  scope :expired, -> { where('expires_at IS NOT NULL AND expires_at <= ?', Time.current) }
  scope :for_team, ->(team) { where(team: team) }
  scope :global, -> { where(team_id: nil) }

  def grant?
    grant_type == 'grant'
  end

  def revoke?
    grant_type == 'revoke'
  end

  def active?
    expires_at.nil? || expires_at > Time.current
  end

  def expired?
    expires_at.present? && expires_at <= Time.current
  end
end
