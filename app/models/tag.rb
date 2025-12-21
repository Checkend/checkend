class Tag < ApplicationRecord
  has_many :problem_tags, dependent: :destroy
  has_many :problems, through: :problem_tags

  validates :name, presence: true,
                   uniqueness: { case_sensitive: false },
                   length: { maximum: 50 },
                   format: { with: /\A[a-z0-9\-_]+\z/i, message: 'only allows letters, numbers, hyphens, and underscores' }

  before_save :normalize_name

  private

  def normalize_name
    self.name = name.downcase.strip
  end
end
