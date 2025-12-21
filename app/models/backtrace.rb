class Backtrace < ApplicationRecord
  has_many :notices, dependent: :nullify

  validates :fingerprint, presence: true, uniqueness: true
  validates :lines, presence: true

  def self.generate_fingerprint(lines)
    Digest::SHA256.hexdigest(lines.to_json)
  end

  def self.find_or_create_by_lines(lines)
    fingerprint = generate_fingerprint(lines)
    find_or_create_by(fingerprint: fingerprint) do |bt|
      bt.lines = lines
    end
  end
end
