module Noticed
  module DeliveryMethods
    class GitHubDelivery < DeliveryMethod
      required_options :json

      def deliver
        headers = evaluate_option(:headers) || default_headers
        json = evaluate_option(:json)
        response = post_request url, headers: headers, json: json

        if raise_if_not_ok? && !success?(response)
          raise ResponseUnsuccessful.new(response, url, {headers: headers, json: json})
        end

        response
      end

      def url
        evaluate_option(:url)
      end

      def default_headers
        {
          'Content-Type' => 'application/json',
          'Accept' => 'application/vnd.github.v3+json',
          'Authorization' => "token #{evaluate_option(:token)}"
        }
      end

      def raise_if_not_ok?
        value = evaluate_option(:raise_if_not_ok)
        value.nil? || value
      end

      def success?(response)
        response.is_a?(Net::HTTPSuccess)
      end
    end
  end
end

