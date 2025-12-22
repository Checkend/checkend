# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).

# Demo user
user = User.find_or_create_by!(email_address: "demo@example.com") do |u|
  u.password = "password123"
end
puts "Created user: #{user.email_address} (password: password123)"

# Demo app
app = App.find_or_create_by!(name: "Demo Rails App", user: user) do |a|
  a.environment = "production"
end
puts "Created app: #{app.name} (API key: #{app.api_key})"

# Sample problems and notices for demo
if app.problems.empty?
  # Problem 1: NoMethodError
  problem1 = Problem.create!(
    app: app,
    error_class: "NoMethodError",
    error_message: "undefined method `name' for nil:NilClass",
    fingerprint: Digest::SHA256.hexdigest("NoMethodError|app/models/user.rb:42"),
    status: "unresolved",
    first_noticed_at: 3.days.ago,
    last_noticed_at: 1.hour.ago,
    notices_count: 0
  )

  backtrace1 = Backtrace.find_or_create_by_lines([
    { "file" => "app/models/user.rb", "line" => 42, "method" => "full_name" },
    { "file" => "app/views/users/show.html.erb", "line" => 15, "method" => "_app_views_users_show_html_erb" },
    { "file" => "actionview/lib/action_view/base.rb", "line" => 244, "method" => "render" }
  ])

  5.times do |i|
    Notice.create!(
      problem: problem1,
      backtrace: backtrace1,
      error_class: "NoMethodError",
      error_message: "undefined method `name' for nil:NilClass",
      context: { "environment" => "production", "server" => "web-0#{i + 1}" },
      request: { "url" => "https://example.com/users/#{rand(100)}", "method" => "GET" },
      user_info: { "id" => rand(1000), "email" => "user#{i}@example.com" },
      occurred_at: rand(72).hours.ago
    )
  end
  puts "Created problem: #{problem1.error_class} with #{problem1.reload.notices_count} notices"

  # Problem 2: ActiveRecord::RecordNotFound
  problem2 = Problem.create!(
    app: app,
    error_class: "ActiveRecord::RecordNotFound",
    error_message: "Couldn't find User with 'id'=999",
    fingerprint: Digest::SHA256.hexdigest("ActiveRecord::RecordNotFound|app/controllers/users_controller.rb:15"),
    status: "unresolved",
    first_noticed_at: 1.week.ago,
    last_noticed_at: 2.hours.ago,
    notices_count: 0
  )

  backtrace2 = Backtrace.find_or_create_by_lines([
    { "file" => "app/controllers/users_controller.rb", "line" => 15, "method" => "show" },
    { "file" => "actionpack/lib/action_controller/metal.rb", "line" => 227, "method" => "dispatch" }
  ])

  12.times do |i|
    Notice.create!(
      problem: problem2,
      backtrace: backtrace2,
      error_class: "ActiveRecord::RecordNotFound",
      error_message: "Couldn't find User with 'id'=#{rand(900..999)}",
      context: { "environment" => "production" },
      request: { "url" => "https://example.com/users/#{rand(900..999)}", "method" => "GET" },
      occurred_at: rand(168).hours.ago
    )
  end
  puts "Created problem: #{problem2.error_class} with #{problem2.reload.notices_count} notices"

  # Problem 3: Resolved error
  problem3 = Problem.create!(
    app: app,
    error_class: "ArgumentError",
    error_message: "wrong number of arguments (given 2, expected 1)",
    fingerprint: Digest::SHA256.hexdigest("ArgumentError|app/services/payment_processor.rb:88"),
    status: "resolved",
    resolved_at: 1.day.ago,
    first_noticed_at: 2.weeks.ago,
    last_noticed_at: 2.days.ago,
    notices_count: 0
  )

  3.times do
    Notice.create!(
      problem: problem3,
      error_class: "ArgumentError",
      error_message: "wrong number of arguments (given 2, expected 1)",
      context: { "environment" => "production" },
      occurred_at: rand(336).hours.ago
    )
  end
  puts "Created problem: #{problem3.error_class} (resolved) with #{problem3.reload.notices_count} notices"
end

puts "\nSeed complete!"
puts "Login: demo@example.com / password123"
