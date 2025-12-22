class App < ApplicationRecord
  belongs_to :user
  has_many :problems, dependent: :destroy

  has_secure_token :api_key

  validates :name, presence: true
  validates :api_key, uniqueness: true
  validates :slug, presence: true, uniqueness: { scope: :user_id }

  before_validation :generate_slug, on: :create
  before_validation :update_slug, on: :update, if: -> { name_changed? && name.present? }

  def to_param
    slug
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

    while user&.apps&.where(slug: slug)&.where&.not(id: id)&.exists?
      self.slug = "#{base_slug}-#{counter}"
      counter += 1
    end
  end
end
