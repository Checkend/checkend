class App < ApplicationRecord
  has_many :problems, dependent: :destroy
  has_many :team_assignments, dependent: :destroy
  has_many :teams, through: :team_assignments
  has_many :user_notification_preferences, dependent: :destroy

  has_secure_token :ingestion_key

  validates :name, presence: true
  validates :ingestion_key, uniqueness: true
  validates :slug, presence: true, uniqueness: true

  before_validation :generate_slug, on: :create
  before_validation :update_slug, on: :update, if: -> { name_changed? && name.present? }

  def to_param
    slug
  end

  def accessible_by?(user)
    return false unless user

    teams.joins(:team_members).where(team_members: { user_id: user.id }).exists?
  end

  def team_members
    User.joins(team_members: :team)
        .joins('INNER JOIN team_assignments ON team_assignments.team_id = teams.id')
        .where('team_assignments.app_id = ?', id)
        .distinct
  end

  def notification_recipients(event_type)
    users = team_members.to_a.uniq
    users.select { |u| u.wants_notification?(self, event_type) }
  end

  private

  def generate_slug
    self.slug = slugify(name)
    ensure_unique_slug
  end

  def update_slug
    self.slug = slugify(name)
    ensure_unique_slug
  end

  def slugify(string)
    return nil if string.blank?
    string.downcase.gsub(/[^a-z0-9]+/, '-').gsub(/^-|-$/, '')
  end

  def ensure_unique_slug
    return if slug.blank?

    base_slug = slug
    counter = 1

    while App.where(slug: slug).where.not(id: id).exists?
      self.slug = "#{base_slug}-#{counter}"
      counter += 1
    end
  end
end
