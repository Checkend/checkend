class User < ApplicationRecord
  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :apps, dependent: :destroy
  has_many :notifications, as: :recipient, dependent: :destroy, class_name: 'Noticed::Notification'

  normalizes :email_address, with: ->(e) { e.strip.downcase }

  validates :email_address, presence: true, uniqueness: true, format: { with: URI::MailTo::EMAIL_REGEXP }
end
