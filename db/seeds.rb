# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).

# Base date for all timestamps - ensures reproducibility
base_date = Time.zone.parse("2024-12-20 00:00:00")

# Demo user (matching fixture pattern)
user = User.find_or_create_by!(email_address: "demo@example.com") do |u|
  u.password = "password"
  u.site_admin = true
end
# Ensure site_admin is set even if user already exists
user.update!(site_admin: true) unless user.site_admin?
puts "Created user: #{user.email_address} (password: password, site_admin: #{user.site_admin?})"

# Team structure (new architecture)
team = Team.find_or_create_by!(name: "Demo Team", owner: user) do |t|
  # Team name and owner are set above
end
puts "Created team: #{team.name}"

# TeamMember - user as admin
team_member = TeamMember.find_or_create_by!(team: team, user: user) do |tm|
  tm.role = "admin"
end
puts "Created team member: #{user.email_address} as #{team_member.role}"

# App (matching fixture name and structure)
app = App.find_or_create_by!(name: "My Rails App") do |a|
  a.environment = "production"
  a.ingestion_key = "demo_ingestion_key_123456789012345678901234" # Fixed ingestion key for reproducibility
end
puts "Created app: #{app.name} (slug: #{app.slug}, Ingestion key: #{app.ingestion_key})"

# TeamAssignment - link team to app
team_assignment = TeamAssignment.find_or_create_by!(team: team, app: app)
puts "Created team assignment: #{team.name} -> #{app.name}"

# Tags (from fixtures)
tags = {}
%w[critical frontend backend database].each do |tag_name|
  tags[tag_name] = Tag.find_or_create_by!(name: tag_name)
end
puts "Created tags: #{tags.keys.join(', ')}"

# Sample problems and notices for demo (using fixture data structure)
if app.problems.empty?
  # Problem 1: NoMethodError (from fixtures)
  problem1_fingerprint = Problem.generate_fingerprint(
    "NoMethodError",
    "undefined method 'foo' for nil:NilClass",
    "app/models/user.rb:42"
  )
  problem1 = Problem.find_or_create_by!(app: app, fingerprint: problem1_fingerprint) do |p|
    p.error_class = "NoMethodError"
    p.error_message = "undefined method 'foo' for nil:NilClass"
    p.status = "unresolved"
    p.first_noticed_at = base_date - 1.week
    p.last_noticed_at = base_date - 1.hour
  end

  # Backtrace 1 (from fixtures)
  backtrace1_lines = [ { "file" => "app/models/user.rb", "line" => 42, "method" => "save" } ]
  backtrace1 = Backtrace.find_or_create_by_lines(backtrace1_lines)

  # Create 5 notices for problem 1 (matching fixture notices_count)
  notice_times_1 = [
    base_date - 1.week + 1.day,
    base_date - 1.week + 3.days,
    base_date - 1.week + 5.days,
    base_date - 1.week + 6.days + 12.hours,
    base_date - 1.hour
  ]

  5.times do |i|
    Notice.find_or_create_by!(
      problem: problem1,
      backtrace: backtrace1,
      error_class: "NoMethodError",
      error_message: "undefined method 'foo' for nil:NilClass",
      occurred_at: notice_times_1[i]
    ) do |n|
      if i == 4 # Last notice with context (matching fixture pattern)
        n.context = { "environment" => "production", "server" => "web-01", "version" => "1.2.3" }
      else
        n.context = { "environment" => "production" }
      end
    end
  end
  puts "Created problem: #{problem1.error_class} with #{problem1.reload.notices_count} notices"

  # Problem 2: ActiveRecord::RecordNotFound (from fixtures)
  problem2_fingerprint = Problem.generate_fingerprint(
    "ActiveRecord::RecordNotFound",
    "Couldn't find User with id=999",
    "app/controllers/users_controller.rb:15"
  )
  problem2 = Problem.find_or_create_by!(app: app, fingerprint: problem2_fingerprint) do |p|
    p.error_class = "ActiveRecord::RecordNotFound"
    p.error_message = "Couldn't find User with id=999"
    p.status = "unresolved"
    p.first_noticed_at = base_date - 2.days
    p.last_noticed_at = base_date - 2.hours
  end

  # Backtrace 2 (from fixtures)
  backtrace2_lines = [ { "file" => "app/controllers/api_controller.rb", "line" => 15, "method" => "handle_error" } ]
  backtrace2 = Backtrace.find_or_create_by_lines(backtrace2_lines)

  # Create 2 notices for problem 2 (matching fixture notices_count) with request and user_info
  notice_times_2 = [
    base_date - 2.days + 1.hour,
    base_date - 2.hours
  ]

  # First notice with request data (matching fixture "with_request")
  Notice.find_or_create_by!(
    problem: problem2,
    error_class: "ActiveRecord::RecordNotFound",
    error_message: "Couldn't find User with id=999",
    occurred_at: notice_times_2[0]
  ) do |n|
    n.backtrace = backtrace2
    n.request = { "method" => "GET", "url" => "/users/123", "params" => { "id" => "123" } }
  end

  # Second notice with user_info (matching fixture "with_user")
  Notice.find_or_create_by!(
    problem: problem2,
    error_class: "ActiveRecord::RecordNotFound",
    error_message: "Couldn't find User with id=999",
    occurred_at: notice_times_2[1]
  ) do |n|
    n.backtrace = backtrace2
    n.user_info = { "id" => 42, "email" => "john@example.com", "name" => "John Doe" }
  end

  puts "Created problem: #{problem2.error_class} with #{problem2.reload.notices_count} notices"

  # Problem 3: ArgumentError (Resolved) (from fixtures)
  problem3_fingerprint = Problem.generate_fingerprint(
    "ArgumentError",
    "wrong number of arguments",
    "app/services/processor.rb:88"
  )
  problem3 = Problem.find_or_create_by!(app: app, fingerprint: problem3_fingerprint) do |p|
    p.error_class = "ArgumentError"
    p.error_message = "wrong number of arguments"
    p.status = "resolved"
    p.resolved_at = base_date - 1.day
    p.first_noticed_at = base_date - 2.weeks
    p.last_noticed_at = base_date - 2.days
  end

  # Create 10 notices for problem 3 (matching fixture notices_count)
  # Distribute evenly between first_noticed_at and last_noticed_at
  notice_times_3 = []
  time_span = (problem3.last_noticed_at - problem3.first_noticed_at).to_f
  10.times do |i|
    notice_times_3 << problem3.first_noticed_at + (time_span * i / 9.0)
  end

  10.times do |i|
    Notice.find_or_create_by!(
      problem: problem3,
      error_class: "ArgumentError",
      error_message: "wrong number of arguments",
      occurred_at: notice_times_3[i]
    ) do |n|
      n.context = { "environment" => "production" }
    end
  end
  puts "Created problem: #{problem3.error_class} (resolved) with #{problem3.reload.notices_count} notices"

  # ProblemTags (matching fixture relationships)
  # Problem 1: critical, frontend
  ProblemTag.find_or_create_by!(problem: problem1, tag: tags["critical"])
  ProblemTag.find_or_create_by!(problem: problem1, tag: tags["frontend"])

  # Problem 2: backend
  ProblemTag.find_or_create_by!(problem: problem2, tag: tags["backend"])

  puts "Created problem tags linking problems to tags"
end

puts "\nSeed complete!"
puts "Login: demo@example.com / password"
