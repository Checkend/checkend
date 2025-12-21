class App < ApplicationRecord
  belongs_to :user
  has_many :problems, dependent: :destroy

  has_secure_token :api_key

  validates :name, presence: true
  validates :api_key, uniqueness: true
end
