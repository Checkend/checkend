class User < ApplicationRecord
  extend FriendlyId
  friendly_id :email_local_part, use: :slugged

  PASSWORD_HISTORY_LIMIT = 5

  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :password_histories, dependent: :destroy
  has_many :notifications, as: :recipient, dependent: :destroy, class_name: 'Noticed::Notification'
  has_many :team_members, dependent: :destroy
  has_many :teams, through: :team_members
  has_many :owned_teams, class_name: 'Team', foreign_key: 'owner_id', dependent: :destroy
  has_many :user_notification_preferences, dependent: :destroy
  has_many :team_invitations, foreign_key: 'invited_by_id', dependent: :destroy

  # Permission associations
  has_many :user_permissions, dependent: :destroy
  has_many :record_permissions, dependent: :destroy
  has_many :granted_user_permissions, class_name: 'UserPermission',
                                      foreign_key: 'granted_by_id',
                                      dependent: :nullify
  has_many :granted_record_permissions, class_name: 'RecordPermission',
                                        foreign_key: 'granted_by_id',
                                        dependent: :nullify

  normalizes :email_address, with: ->(e) { e.strip.downcase }

  validates :email_address, presence: true, uniqueness: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :slug, uniqueness: true, allow_nil: true
  validate :password_not_recently_used, if: :password_digest_changed?

  before_update :save_password_to_history, if: :password_digest_changed?

  scope :site_admins, -> { where(site_admin: true) }

  def site_admin?
    site_admin
  end

  def email_local_part
    email_address.to_s.split('@').first
  end

  def should_generate_new_friendly_id?
    email_address_changed? || slug.blank?
  end

  def accessible_apps
    App.joins(team_assignments: { team: :team_members })
       .where(team_members: { user_id: id })
       .distinct
  end

  def wants_notification?(app, event_type)
    pref = user_notification_preferences.find_by(app: app)
    return app.notify_on_new_problem? if event_type == :new_problem && pref.nil?
    return app.notify_on_reoccurrence? if event_type == :reoccurrence && pref.nil?
    return pref.notify_on_new_problem? if event_type == :new_problem
    return pref.notify_on_reoccurrence? if event_type == :reoccurrence
    false
  end

  def admin_of_team?(team)
    team_members.find_by(team: team)&.admin? || false
  end

  def as_json(options = {})
    super(options).merge(
      'id' => id,
      'slug' => slug,
      'email_address' => email_address,
      'site_admin' => site_admin,
      'last_logged_in_at' => last_logged_in_at&.iso8601,
      'created_at' => created_at&.iso8601,
      'updated_at' => updated_at&.iso8601
    ).except('password_digest')
  end

  def password_previously_used?(new_password)
    password_histories.order(created_at: :desc).limit(PASSWORD_HISTORY_LIMIT).any? do |history|
      BCrypt::Password.new(history.password_digest).is_password?(new_password)
    end
  end

  private

  def password_not_recently_used
    return unless password.present?

    # Check against current password (before the change)
    if password_digest_was.present? && BCrypt::Password.new(password_digest_was).is_password?(password)
      errors.add(:password, 'has been used recently. Please choose a different password.')
      return
    end

    # Check against password history
    if password_previously_used?(password)
      errors.add(:password, 'has been used recently. Please choose a different password.')
    end
  end

  def save_password_to_history
    return unless password_digest_was.present?

    password_histories.create!(password_digest: password_digest_was)

    # Keep only the last N passwords
    old_histories = password_histories.order(created_at: :desc).offset(PASSWORD_HISTORY_LIMIT)
    old_histories.destroy_all if old_histories.exists?
  end
end
