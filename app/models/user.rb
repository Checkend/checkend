class User < ApplicationRecord
  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :notifications, as: :recipient, dependent: :destroy, class_name: 'Noticed::Notification'
  has_many :team_members, dependent: :destroy
  has_many :teams, through: :team_members
  has_many :owned_teams, class_name: 'Team', foreign_key: 'owner_id', dependent: :destroy
  has_many :user_notification_preferences, dependent: :destroy
  has_many :team_invitations, foreign_key: 'invited_by_id', dependent: :destroy

  normalizes :email_address, with: ->(e) { e.strip.downcase }

  validates :email_address, presence: true, uniqueness: true, format: { with: URI::MailTo::EMAIL_REGEXP }

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
      'email_address' => email_address,
      'created_at' => created_at&.iso8601,
      'updated_at' => updated_at&.iso8601
    ).except('password_digest')
  end
end
